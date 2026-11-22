import dataclasses

import httpx
import pytest

from yazzy.config import settings
from yazzy.modules.garage import car_picture

VIN = "WVWZZZ1KZ8W000001"


@pytest.fixture
def carimage(monkeypatch):
    """carimage.dev stand-in: one VIN in the catalog, one decoded but not in the catalog."""
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url.path)
        assert request.headers["authorization"] == "Bearer cimg_test"
        if request.url.path == f"/api/v1/vin/{VIN}":
            vehicle = {"id": "veh_golf2008", "make": "volkswagen", "model": "golf", "year": 2008}
            return httpx.Response(200, json={"data": {"make": "VOLKSWAGEN", "model": "Golf", "year": 2008, "vehicle": vehicle}})
        if request.url.path == "/api/v1/vin/WVWZZZ1KZ8W000002":
            return httpx.Response(200, json={"data": {"make": "VOLKSWAGEN", "model": "Rare", "year": 2008, "vehicle": None}})
        if request.url.path == "/api/v1/vin/VNKKBAC390A160510":  # European: no model year in the VIN
            return httpx.Response(200, json={"data": {"make": "Toyota", "model": "Yaris", "year": None, "vehicle": None}})
        if request.url.path == "/api/v1/vin/SHHFK2750EU000001":  # the decoder knows the make, not the model
            return httpx.Response(200, json={"data": {"make": "HONDA", "model": None, "year": None, "vehicle": None}})
        if request.url.path == "/api/v1/vehicles":
            params = request.url.params
            if params.get("makeId") == "7":
                return httpx.Response(200, json={"data": {"models": [{"name": "Jazz", "id": "veh_jazz2019"}, {"name": "Civic"}, {"name": "Accord"}]}})
            if "year" in params and "make" not in params:
                return httpx.Response(200, json={"data": {"makes": [{"makeId": 3, "makeName": "Toyota"}, {"makeId": 7, "makeName": "Honda"}]}})
            if params.get("make") == "Honda" and params.get("model") == "Jazz":
                return httpx.Response(200, json={"data": {"vehicles": [{"year": 2015, "id": "veh_jazz2015"}, {"year": 2019, "id": "veh_jazz2019"}]}})
            if params.get("make", "").lower() == "honda":
                return httpx.Response(404, json={"error": "unknown model"})
            assert params["make"] == "Toyota" and params["model"] == "Yaris"
            return httpx.Response(200, json={"data": {"vehicles": [{"year": 2008, "id": "veh_yaris2008"}, {"year": 2009, "id": "veh_yaris2009"}]}})
        if request.url.path.startswith("/api/v1/vin/"):
            return httpx.Response(404, json={"error": "not recognized"})
        if request.url.path == "/api/v1/images/car":
            assert request.url.params["vehicle"] in ("veh_golf2008", "veh_yaris2009", "veh_jazz2019", "veh_jazz2015")
            assert request.url.params["background"] == "transparent"
            return httpx.Response(200, content=b"RIFFwebp", headers={"content-type": "image/webp"})
        return httpx.Response(500)

    monkeypatch.setattr(car_picture, "settings", dataclasses.replace(settings, car_image_api_key="cimg_test"))
    monkeypatch.setattr(
        car_picture, "client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler), headers={"Authorization": "Bearer cimg_test"}),
    )

    class Now:  # run the fetch inline instead of in a thread
        def __init__(self, target, args, **_):
            self.run = lambda: target(*args)

        def start(self):
            self.run()

    monkeypatch.setattr(car_picture.threading, "Thread", Now)
    return calls


def test_vin_gives_the_car_and_its_picture_fetched_once(client, carimage):
    first = client.get(f"/api/v1/car-picture/{VIN}").json()
    assert first == {"make": "VOLKSWAGEN", "model": "Golf", "year": 2008, "status": "PENDING"}
    ready = client.get(f"/api/v1/car-picture/{VIN.lower()}").json()
    assert ready["status"] == "READY" and ready["url"] == "/api/v1/car-pictures/veh_golf2008.webp"
    assert carimage.count("/api/v1/images/car") == 1
    file = client.get(ready["url"])
    assert file.status_code == 200 and file.content == b"RIFFwebp" and file.headers["content-type"] == "image/webp"


def test_unknown_cars_keep_the_apps_own_picture(client, carimage):
    rare = client.get("/api/v1/car-picture/WVWZZZ1KZ8W000002").json()
    assert rare == {"make": "VOLKSWAGEN", "model": "Rare", "year": 2008, "status": "NONE"}
    assert client.get("/api/v1/car-picture/WVWZZZ1KZ8W000003").json() == {"status": "NONE", "needsModel": True}
    assert client.get("/api/v1/car-picture/SHORT").status_code == 422
    assert client.get("/api/v1/car-pictures/veh_missing1.webp").status_code == 404
    assert client.get("/api/v1/car-pictures/..%2Fsecret.webp").status_code == 404


def test_without_a_key_nothing_is_asked(client, monkeypatch):
    monkeypatch.setattr(car_picture, "settings", dataclasses.replace(settings, car_image_api_key=""))
    assert client.get(f"/api/v1/car-picture/{VIN}").json() == {"status": "NONE"}


def test_needs_sign_in():
    from fastapi.testclient import TestClient

    from yazzy.api.main import app

    with TestClient(app) as anonymous:
        assert anonymous.get(f"/api/v1/car-picture/{VIN}").status_code == 401


def test_european_vin_asks_for_the_year_then_shows_that_year(client, carimage):
    vin = "VNKKBAC390A160510"
    ask = client.get(f"/api/v1/car-picture/{vin}").json()
    assert ask == {"make": "Toyota", "model": "Yaris", "year": None, "status": "NONE", "needsYear": True, "years": [2009, 2008]}
    assert client.get(f"/api/v1/car-picture/{vin}?year=2009").json()["status"] == "PENDING"
    ready = client.get(f"/api/v1/car-picture/{vin}?year=2009").json()
    assert ready == {"make": "Toyota", "model": "Yaris", "year": 2009, "status": "READY", "url": "/api/v1/car-pictures/veh_yaris2009.webp"}
    assert client.get(f"/api/v1/car-picture/{vin}?year=1995").json()["needsYear"] is True


def test_vin_without_a_model_asks_the_owner_for_it_and_shows_that_model(client, carimage):
    vin = "SHHFK2750EU000001"
    assert client.get(f"/api/v1/car-picture/{vin}").json() == {"make": "HONDA", "status": "NONE", "needsModel": True}
    listed = client.get("/api/v1/car-models", params={"make": "Honda", "year": 2019}).json()
    assert listed == {"models": ["Accord", "Civic", "Jazz"]}
    assert client.get("/api/v1/car-models", params={"make": "Unknown Make", "year": 2019}).json() == {"models": []}
    pick = {"make": "Honda", "model": "Jazz", "year": 2019}
    assert client.get(f"/api/v1/car-picture/{vin}", params=pick).json()["status"] == "PENDING"
    ready = client.get(f"/api/v1/car-picture/{vin}", params=pick).json()
    assert ready == {"make": "Honda", "model": "Jazz", "year": 2019, "status": "READY", "url": "/api/v1/car-pictures/veh_jazz2019.webp"}
    # A year the catalog lacks shows the nearest one it has, and keeps the owner's year.
    near = client.get(f"/api/v1/car-picture/{vin}", params={**pick, "year": 2016}).json()
    assert near["year"] == 2016 and near["status"] in ("PENDING", "READY")
    # A model the catalog does not carry still names the car, with no picture.
    odd = client.get(f"/api/v1/car-picture/{vin}", params={"make": "Honda", "model": "Nothing", "year": 2019}).json()
    assert odd == {"make": "Honda", "model": "Nothing", "year": 2019, "status": "NONE"}


def test_a_vin_the_decoder_does_not_know_can_still_be_set_by_make_and_model(client, carimage):
    vin = "WVWZZZ1KZ8W000003"
    pick = {"make": "Honda", "model": "Jazz", "year": 2019}
    assert client.get(f"/api/v1/car-picture/{vin}", params=pick).json()["status"] in ("PENDING", "READY")
    assert client.get("/api/v1/car-models", params={"make": "Honda"}).status_code == 422
