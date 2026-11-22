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
        if request.url.path.startswith("/api/v1/vin/"):
            return httpx.Response(404, json={"error": "not recognized"})
        if request.url.path == "/api/v1/images/car":
            assert request.url.params["vehicle"] == "veh_golf2008"
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
    assert client.get("/api/v1/car-picture/WVWZZZ1KZ8W000003").json() == {"status": "NONE"}
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
