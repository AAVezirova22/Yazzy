from fastapi.testclient import TestClient

from yazzy.api.main import app

APK = b"PK\x03\x04" + b"x" * 2_000_000  # larger than the normal 1 MB body limit


def publish(c, code, token="test-release-token", body=APK):
    return c.post(
        f"/api/v1/app/releases?versionCode={code}&version=0.1.0",
        content=body,
        headers={"X-Release-Token": token, "Content-Type": "application/octet-stream"},
    )


def test_publish_check_and_download(client):
    assert client.get("/api/v1/app/release").json() == {"versionCode": None}
    with TestClient(app) as anonymous:
        assert publish(anonymous, 30, token="wrong").status_code == 403
        assert publish(anonymous, 30, body=b"not a zip").status_code == 400
        assert publish(anonymous, 30).status_code == 201
        assert publish(anonymous, 31).status_code == 201
        assert anonymous.get("/api/v1/app/release").status_code == 401
    latest = client.get("/api/v1/app/release").json()
    assert latest["versionCode"] == 31 and latest["size"] == len(APK)
    with TestClient(app) as anonymous:
        apk = anonymous.get(latest["url"])
        assert apk.status_code == 200 and apk.content == APK
        assert anonymous.get(latest["url"].replace("sig=", "sig=0")).status_code == 403
