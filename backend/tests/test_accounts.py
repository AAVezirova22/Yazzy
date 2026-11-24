import time
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from test_api import upload

from yazzy.api.main import app


def register(c, email="ana@example.com", password="correct horse", **extra):
    return c.post("/api/v1/auth/register", json={"email": email, "password": password, **extra})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_login_and_token_use():
    with TestClient(app) as c:
        r = register(c, name="Ana")
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["new"] is True and body["account"]["email"] == "ana@example.com"
        token = body["token"]
        # A fresh account starts with an empty garage of its own.
        assert c.get("/api/v1/vehicles", headers=bearer(token)).json() == []
        added = c.post("/api/v1/vehicles", json={"name": "Van", "category": "BUSINESS"}, headers=bearer(token))
        assert added.status_code == 201 and added.json()["category"] == "BUSINESS"
        assert register(c, email="ANA@example.com").status_code == 409
        assert register(c, email="not-an-email").status_code == 422
        assert register(c, email="b@example.com", password="short").status_code == 422

        login = c.post("/api/v1/auth/login", json={"email": "Ana@Example.com", "password": "correct horse"})
        assert login.status_code == 200 and login.json()["new"] is False
        again = login.json()["token"]
        assert [v["name"] for v in c.get("/api/v1/vehicles", headers=bearer(again)).json()] == ["Van"]
        assert c.get("/api/v1/auth/account", headers=bearer(again)).json()["account"]["name"] == "Ana"
        assert c.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "wrong"}).status_code == 401

        assert c.post("/api/v1/auth/sign-out", headers=bearer(again)).status_code == 200
        assert c.get("/api/v1/vehicles", headers=bearer(again)).status_code == 401
        assert c.get("/api/v1/vehicles", headers=bearer("made-up-token")).status_code == 401


def test_accounts_never_see_each_other():
    with TestClient(app) as c:
        a = register(c, email="a@example.com").json()["token"]
        b = register(c, email="b@example.com").json()["token"]
        car = c.post("/api/v1/vehicles", json={"name": "Mine"}, headers=bearer(a)).json()
        assert c.get("/api/v1/vehicles", headers=bearer(b)).json() == []
        assert c.get(f"/api/v1/vehicles/{car['id']}", headers=bearer(b)).status_code == 404


def test_first_account_from_a_signed_in_phone_keeps_the_shared_garage(client):
    shared = [v["name"] for v in client.get("/api/v1/vehicles").json()]
    first = register(client, email="owner@example.com", claim=True).json()
    assert [v["name"] for v in client.get("/api/v1/vehicles", headers=bearer(first["token"])).json()] == shared
    # Only once: a second account asking the same gets an empty garage.
    second = register(client, email="other@example.com", claim=True).json()
    assert client.get("/api/v1/vehicles", headers=bearer(second["token"])).json() == []
    # Without the shared session a claim is refused quietly.
    with TestClient(app) as stranger:
        third = register(stranger, email="third@example.com", claim=True).json()
        assert stranger.get("/api/v1/vehicles", headers=bearer(third["token"])).json() == []


def test_business_dashboard_shows_last_drive_and_live_position(client, enrolled):
    vehicle, enrol = enrolled
    version = client.get(f"/api/v1/vehicles/{vehicle['id']}").json()["version"]
    assert client.patch(f"/api/v1/vehicles/{vehicle['id']}", json={"version": version, "category": "BUSINESS"}).status_code == 200
    client.post("/api/v1/vehicles", json={"name": "Family car"})  # Personal: not on the dashboard
    start = max(time.time(), enrol["validFrom"]) + 0.01
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat()  # noqa: E731
    samples = [
        {"sequence": 0, "observedAt": iso(start), "signal": "VEHICLE_SPEED", "value": 48, "unit": "km/h"},
        {"sequence": 1, "observedAt": iso(start + 0.5), "signal": "GPS", "unit": "deg",
         "value": {"latitude": 42.69, "longitude": 23.32, "accuracy": 8, "provider": "PHONE"}},
    ]
    data = {"schemaVersion": 1, "batchId": "dash-1", "deviceId": enrol["deviceId"], "assignmentId": enrol["assignmentId"],
            "sessionId": "dash-session", "sequenceStart": 0, "source": "MOBILE_OBD", "platform": "ANDROID", "samples": samples}
    assert upload(client, enrol, data).status_code == 202
    board = client.get("/api/v1/business/dashboard").json()
    assert [car["name"] for car in board["cars"]] == [vehicle["name"]]
    car = board["cars"][0]
    assert car["live"] is True and car["speedKmh"] == 48
    assert car["position"]["latitude"] == 42.69 and car["position"]["longitude"] == 23.32
    assert board["summary"]["cars"] == 1 and board["summary"]["liveNow"] == 1


def test_vehicle_documents_are_saved_but_never_identity_numbers(client):
    car = client.get("/api/v1/vehicles").json()[0]
    docs = {"plate": "A2612PT", "gtpUntil": "2027-03-12", "insuranceUntil": "2027-03-03",
            "vignette": {"until": "2027-03-03T23:59:59", "active": True, "checkedAt": 1}}
    saved = client.patch(f"/api/v1/vehicles/{car['id']}", json={"version": car["version"], "documents": docs})
    assert saved.status_code == 200 and saved.json()["documents"] == docs
    leak = client.patch(f"/api/v1/vehicles/{car['id']}", json={"version": saved.json()["version"], "documents": {**docs, "egn": "1"}})
    assert leak.status_code == 422
