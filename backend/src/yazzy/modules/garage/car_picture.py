"""The car's make, model and year from its VIN, and a studio picture of that exact model year, from carimage.dev.

The phone sends the VIN. The API decodes it with carimage.dev (free; NHTSA vPIC data), which also names the
catalog vehicle for that make, model and year. The render (transparent background, front three-quarter view)
is fetched once per vehicle and kept in the database, so each model uses one image of the plan's allowance
and phones load it from this API. The key (CAR_IMAGE_API_KEY) never leaves the server.

Most European VINs do not encode the model year (position 10 is 0). Then the answer says needsYear with the
years the catalog has for that model, the owner picks one in the app, and the phone asks again with ?year=.
Nothing is guessed: a VIN the decoder does not know, or a vehicle the catalog does not carry, answers NONE and
the app keeps its own car.
"""

import logging
import threading
import time

import httpx
from sqlalchemy.exc import IntegrityError

from yazzy.config import settings
from yazzy.infrastructure.db import Session
from yazzy.infrastructure.models import CarPicture

log = logging.getLogger(__name__)
BASE = "https://carimage.dev/api/v1"
RETRY_AFTER = 86400  # a failed fetch (offline, allowance used up) is tried again a day later
# The paint and framing of every picture: the app's steel blue, 2:1, trimmed to the car.
LOOK = {"view": "front-3-4", "color": "4a6d94", "format": "webp", "w": "1200", "h": "600",
        "fit": "contain", "background": "transparent", "framing": "balanced"}
_lock = threading.Lock()
_running: set[str] = set()


def client() -> httpx.Client:
    return httpx.Client(headers={"Authorization": f"Bearer {settings.car_image_api_key}"}, timeout=60)


def decode(vin: str) -> dict | None:
    """{make, model, year, vehicle_id} for a VIN; vehicle_id is None when the catalog lacks the car."""
    with client() as http:
        response = http.get(f"{BASE}/vin/{vin}")
    if response.status_code in (400, 404):
        return None
    response.raise_for_status()
    data = response.json()["data"]
    if not data.get("make") or not data.get("model"):
        return None
    vehicle = data.get("vehicle") or {}
    year = data.get("year")
    return {
        "make": str(data["make"]).strip()[:60],
        "model": str(data["model"]).strip()[:60],
        "year": int(year) if year else None,
        "vehicle_id": vehicle.get("id"),
    }


def catalog(make: str, model: str) -> dict[int, str]:
    """{year: catalog vehicle id} of every year the catalog carries for this make and model (free, public)."""
    with client() as http:
        response = http.get(f"{BASE}/vehicles", params={"make": make, "model": model})
    if response.status_code in (400, 404):
        return {}
    response.raise_for_status()
    return {int(v["year"]): v["id"] for v in response.json()["data"].get("vehicles", []) if v.get("id")}


def fetch(vehicle_id: str):
    status, image = "FAILED", None
    try:
        with client() as http:
            response = http.get(f"{BASE}/images/car", params={"vehicle": vehicle_id, **LOOK})
        if response.status_code == 404:
            status = "NONE"
        else:
            response.raise_for_status()
            status, image = "READY", response.content
    except Exception:
        log.exception("car picture %s failed", vehicle_id)
    with Session() as db, db.begin():
        row = db.get(CarPicture, vehicle_id)
        if row:
            row.status, row.image, row.updated_at = status, image, time.time()
    with _lock:
        _running.discard(vehicle_id)


def _state(vehicle_id: str, car: dict) -> tuple[str, bool]:
    with Session() as db, db.begin():
        row = db.get(CarPicture, vehicle_id)
        if row is None:
            db.add(CarPicture(id=vehicle_id, make=car["make"], model=car["model"], year=car["year"] or 0,
                              status="PENDING", updated_at=time.time()))
            db.flush()
            return "PENDING", True
        stale = time.time() - row.updated_at
        if row.status == "FAILED" and stale > RETRY_AFTER or row.status == "PENDING" and stale > 600:
            row.status, row.updated_at = "PENDING", time.time()
            return "PENDING", True
        return row.status, False


def lookup(vin: str, year: int | None = None) -> dict:
    """What the VIN says and the picture's state: READY (with url), PENDING (ask again shortly) or NONE.

    `year` is the owner's model year, used only when the VIN itself carries none."""
    if not settings.car_image_api_key:
        return {"status": "NONE"}
    car = decode(vin)
    if car is None:
        return {"status": "NONE"}
    vid = car["vehicle_id"]
    if car["year"] is None:
        years = catalog(car["make"], car["model"])
        if year in years:
            car["year"], vid = year, years[year]
        else:
            return {"make": car["make"], "model": car["model"], "year": None, "status": "NONE",
                    "needsYear": True, "years": sorted(years, reverse=True)}
    result = {"make": car["make"], "model": car["model"], "year": car["year"], "status": "NONE"}
    if not vid:
        return result
    try:
        status, start = _state(vid, car)
    except IntegrityError:
        status, start = _state(vid, car)  # another phone asked a moment ago
    if start:
        with _lock:
            start = vid not in _running
            _running.add(vid)
        if start:
            threading.Thread(target=fetch, args=(vid,), name="car-picture", daemon=True).start()
    result["status"] = status
    if status == "READY":
        result["url"] = f"/api/v1/car-pictures/{vid}.webp"
    return result


def image(vehicle_id: str) -> bytes | None:
    with Session() as db:
        row = db.get(CarPicture, vehicle_id)
        return row.image if row and row.status == "READY" else None
