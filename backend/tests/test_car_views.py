import dataclasses
import io

import httpx
import pytest
from PIL import Image

from yazzy.config import settings
from yazzy.modules.garage import car_picture

VIN = "WVWZZZ1KZ8W000001"
BODY = (0x4A, 0x6D, 0x94)  # the paint every picture is rendered in (LOOK["color"])


def render(view):
    """A tiny "car": body paint on the left, a black tyre on the right, transparent around it."""
    picture = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
    for x in range(4, 20):
        for y in range(5, 15):
            picture.putpixel((x, y), (*BODY, 255))
    for x in range(26, 34):
        for y in range(8, 16):
            picture.putpixel((x, y), (20, 20, 20, 255))
    out = io.BytesIO()
    picture.save(out, "WEBP", lossless=True)
    return out.getvalue()


@pytest.fixture
def carimage(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        path = request.url.path
        if path == f"/api/v1/vin/{VIN}":
            vehicle = {"id": "veh_golf2008"}
            return httpx.Response(200, json={"data": {"make": "VOLKSWAGEN", "model": "Golf", "year": 2008, "vehicle": vehicle}})
        if path == "/api/v1/images/car":
            calls.append(request.url.params["view"])
            return httpx.Response(200, content=render(request.url.params["view"]), headers={"content-type": "image/webp"})
        if path == "/api/v1/account":
            return httpx.Response(200, json={"data": {"limits_usage": {"vehicle_images_total": {"used": 2, "limit": 30, "remaining": 28}}}})
        return httpx.Response(500)

    monkeypatch.setattr(car_picture, "settings", dataclasses.replace(settings, car_image_api_key="cimg_test"))
    monkeypatch.setattr(car_picture, "client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))

    class Now:
        def __init__(self, target, args, **_):
            self.run = lambda: target(*args)

        def start(self):
            self.run()

    monkeypatch.setattr(car_picture.threading, "Thread", Now)
    car_picture._painted.clear()
    return calls


def pixel(response, x, y):
    return Image.open(io.BytesIO(response.content)).convert("RGBA").getpixel((x, y))


def test_colour_and_mirror_are_free_and_new_views_are_fetched_once(client, carimage):
    client.get(f"/api/v1/car-picture/{VIN}")
    url = client.get(f"/api/v1/car-picture/{VIN}").json()["url"]
    assert carimage == ["front-3-4"]

    red = client.get(url + "?color=b01020")
    r, g, b, a = pixel(red, 10, 10)
    assert r > 120 and g < 60 and b < 70 and a == 255  # the body is repainted
    assert all(abs(c - 20) <= 4 for c in pixel(red, 30, 12)[:3])  # the tyre is not paint (lossy WebP: ±4)
    assert pixel(red, 1, 1)[3] == 0  # the background stays transparent
    flipped = client.get(url + "?flip=true")
    assert all(abs(x - y) <= 6 for x, y in zip(pixel(flipped, 39 - 10, 10)[:3], pixel(client.get(url), 10, 10)[:3], strict=True))
    assert carimage == ["front-3-4"]  # colours and mirrors never ask carimage.dev again

    state = client.get("/api/v1/car-pictures/veh_golf2008/views").json()
    assert state["views"] == {"front-3-4": "READY"} and state["remaining"] == 28 and "rear" in state["all"]
    assert client.post("/api/v1/car-pictures/veh_golf2008/views/rear").json()["status"] == "PENDING"
    assert client.post("/api/v1/car-pictures/veh_golf2008/views/rear").json()["status"] == "READY"
    assert carimage == ["front-3-4", "rear"]  # one picture for the new view, once
    rear = client.get(url + "?view=rear&color=151619")
    assert rear.status_code == 200 and max(pixel(rear, 10, 10)[:3]) < 60
    assert client.get(url + "?view=side").status_code == 404
    assert client.get(url + "?view=underneath").status_code == 404
    assert client.get(url + "?color=red").status_code == 422
    assert client.post("/api/v1/car-pictures/veh_unknown01/views/rear").json()["status"] == "NONE"
