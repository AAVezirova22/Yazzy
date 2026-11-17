import hashlib

from fastapi.testclient import TestClient

from yazzy.api.main import app

PART = 4 * 1024 * 1024
APK = b"PK\x03\x04" + bytes(range(256)) * (PART * 2 // 256 + 1000)  # three parts, last one short
HEADERS = {"X-Release-Token": "test-release-token"}


def publish(c, code, data=APK, token="test-release-token"):
    meta = {
        "versionCode": code,
        "version": "0.1.0",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    r = c.post("/api/v1/app/releases", json=meta, headers={"X-Release-Token": token})
    if r.status_code != 201:
        return r
    release = r.json()["id"]
    for i in range(0, len(data), PART):
        put = c.put(
            f"/api/v1/app/releases/{release}/parts/{i // PART}",
            content=data[i : i + PART],
            headers=HEADERS,
        )
        assert put.status_code == 200, put.text
    return c.post(f"/api/v1/app/releases/{release}/complete", headers=HEADERS)


def test_publish_check_and_download(client):
    assert client.get("/api/v1/app/release").json() == {"versionCode": None}
    with TestClient(app) as anonymous:
        assert publish(anonymous, 30, token="wrong").status_code == 403
        assert publish(anonymous, 30).status_code == 200
        assert publish(anonymous, 31).status_code == 200
        assert anonymous.get("/api/v1/app/release").status_code == 401
    latest = client.get("/api/v1/app/release").json()
    assert latest["versionCode"] == 31 and latest["size"] == len(APK)
    with TestClient(app) as anonymous:
        apk = anonymous.get(latest["url"])
        assert apk.status_code == 200 and apk.content == APK
        assert anonymous.get(latest["url"].replace("sig=", "sig=0")).status_code == 403


def test_corrupt_upload_keeps_live_release(client):
    with TestClient(app) as publisher:
        assert publish(publisher, 40).status_code == 200
        meta = {"versionCode": 41, "version": "0.1.0", "size": 10, "sha256": "0" * 64}
        release = publisher.post("/api/v1/app/releases", json=meta, headers=HEADERS).json()["id"]
        too_big = publisher.put(
            f"/api/v1/app/releases/{release}/parts/0", content=b"x" * (PART + 1), headers=HEADERS
        )
        assert too_big.status_code in (400, 413)
        publisher.put(f"/api/v1/app/releases/{release}/parts/0", content=b"x" * 10, headers=HEADERS)
        done = publisher.post(f"/api/v1/app/releases/{release}/complete", headers=HEADERS)
        assert done.status_code == 409
    assert client.get("/api/v1/app/release").json()["versionCode"] == 40
