import httpx
from fastapi.testclient import TestClient

from yazzy.api import releases
from yazzy.api.main import app
from yazzy.config import settings

BUILD = {
    "versionCode": 38,
    "version": "0.1.0",
    "size": 1234,
    "sha256": "a" * 64,
    "md5": "b" * 32,
    "apk": "Yazzy-38.apk",
}


def serve(monkeypatch, answer):
    """GitHub, as the API sees it: `answer` is the manifest, or an exception to raise."""
    calls = []

    def fetch():
        calls.append(1)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(releases, "fetch_manifest", fetch)
    monkeypatch.setattr(releases, "_cache", {"at": 0.0, "ok": False, "manifest": None})
    return calls


def test_old_builds_are_sent_to_github_for_the_apk(client, monkeypatch):
    calls = serve(monkeypatch, BUILD)
    latest = client.get("/api/v1/app/release").json()
    assert latest == {
        "versionCode": 38,
        "version": "0.1.0",
        "size": 1234,
        "sha256": "a" * 64,
        "url": "/api/v1/app/apk",
    }
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/v1/app/release").status_code == 401
        apk = anonymous.get(latest["url"], follow_redirects=False)
    assert apk.status_code == 302
    assert apk.headers["location"] == f"{settings.updates_url}/Yazzy-38.apk"
    # Cached: every launch does not reach GitHub.
    assert len(calls) == 1


def test_no_published_build(client, monkeypatch):
    serve(monkeypatch, httpx.HTTPStatusError("404", request=None, response=None))
    assert client.get("/api/v1/app/release").json() == {"versionCode": None}
    assert client.get("/api/v1/app/apk", follow_redirects=False).status_code == 404


def test_last_known_build_survives_a_github_outage(client, monkeypatch):
    serve(monkeypatch, BUILD)
    assert client.get("/api/v1/app/release").json()["versionCode"] == 38

    def down():
        raise httpx.ConnectError("GitHub is down")

    monkeypatch.setattr(releases, "fetch_manifest", down)
    releases._cache["at"] = 0.0
    assert client.get("/api/v1/app/release").json()["versionCode"] == 38


def test_a_manifest_naming_another_path_is_ignored(client, monkeypatch):
    serve(monkeypatch, {**BUILD, "apk": "../../evil/Yazzy.apk"})
    assert client.get("/api/v1/app/release").json() == {"versionCode": None}
