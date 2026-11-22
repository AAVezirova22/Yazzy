"""The car's make, model and year from its VIN, and a studio picture of that exact model year, from carimage.dev.

The phone sends the VIN. The API decodes it with carimage.dev (free; NHTSA vPIC data), which also names the
catalog vehicle for that make, model and year. The render (transparent background, front three-quarter view)
is fetched once per vehicle and kept in the database, so each model uses one image of the plan's allowance
and phones load it from this API. The key (CAR_IMAGE_API_KEY) never leaves the server.

Most European VINs do not encode the model year (position 10 is 0). Then the answer says needsYear with the
years the catalog has for that model, the owner picks one in the app, and the phone asks again with ?year=.
Many non-American VINs name the make but no model, or are not known to the decoder at all. Then the answer says
needsModel, the owner picks the model (models() lists the catalog's models for that make and year) and the phone
asks again with ?make=&model=&year=. Nothing is guessed: a vehicle the catalog does not carry answers NONE and the
app keeps its own car.
"""

import logging
import re
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
    """{make, model, year, vehicle_id} for a VIN; vehicle_id is None when the catalog lacks the car.
    model is "" when the decoder knows the make only. None when the VIN is not known at all."""
    with client() as http:
        response = http.get(f"{BASE}/vin/{vin}")
    if response.status_code in (400, 404):
        return None
    response.raise_for_status()
    data = response.json()["data"]
    if not data.get("make"):
        return None
    vehicle = data.get("vehicle") or {}
    year = data.get("year")
    return {
        "make": str(data["make"]).strip()[:60],
        "model": str(data.get("model") or "").strip()[:60],
        "year": int(year) if year else None,
        "vehicle_id": vehicle.get("id"),
    }


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def catalog(make: str, model: str) -> dict[int, str]:
    """{year: catalog vehicle id} of every year the catalog carries for this make and model (free, public).
    Tries the names as given, then as the catalog's slugs (lower case, hyphens)."""
    for names in ((make, model), (slug(make), slug(model))):
        with client() as http:
            response = http.get(f"{BASE}/vehicles", params={"make": names[0], "model": names[1]})
        if response.status_code in (400, 404):
            continue
        response.raise_for_status()
        found = {int(v["year"]): v["id"] for v in response.json()["data"].get("vehicles", []) if v.get("id")}
        if found:
            return found
    return {}


_models: dict[tuple[str, int], tuple[float, list[str]]] = {}


def models(make: str, year: int) -> list[str]:
    """Every model the catalog has for this make in this year (free, public). Empty when the make is not known."""
    key = (re.sub(r"[^a-z0-9]", "", make.lower()), year)
    hit = _models.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    with client() as http:
        listed = http.get(f"{BASE}/vehicles", params={"year": year})
        if listed.status_code in (400, 404):
            return []
        listed.raise_for_status()
        makes = listed.json()["data"].get("makes", [])
        found = next((m for m in makes if re.sub(r"[^a-z0-9]", "", str(m.get("makeName", "")).lower()) == key[0]), None)
        if not found:
            return []
        response = http.get(f"{BASE}/vehicles", params={"year": year, "makeId": found["makeId"]})
    if response.status_code in (400, 404):
        return []
    response.raise_for_status()
    names = sorted({str(m["name"]).strip() for m in response.json()["data"].get("models", []) if m.get("name")}, key=str.lower)
    _models[key] = (time.time(), names)
    return names


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


def lookup(vin: str, year: int | None = None, make: str | None = None, model: str | None = None) -> dict:
    """What the VIN says and the picture's state: READY (with url), PENDING (ask again shortly) or NONE.

    `year` is the owner's model year, used only when the VIN itself carries none. `make` and `model` are the owner's
    pick, used only when the VIN names no model."""
    if not settings.car_image_api_key:
        return {"status": "NONE"}
    car = decode(vin)
    if car is None or not car["model"]:
        picked = (model or "").strip()[:60]
        brand = ((make or "").strip() or (car or {}).get("make") or "")[:60]
        if not picked or not brand:
            return {**({"make": car["make"]} if car else {}), "status": "NONE", "needsModel": True}
        years = catalog(brand, picked)
        wanted = year or (car or {}).get("year")
        result = {"make": brand, "model": picked, "year": wanted, "status": "NONE"}
        if not years:
            return result
        # The catalog may not carry the owner's exact year: show the nearest year it has.
        nearest = min(years, key=lambda y: abs(y - (wanted or max(years))))
        car = {"make": brand, "model": picked, "year": nearest, "vehicle_id": years[nearest]}
        result["year"] = wanted or nearest
        return picture(car, result)
    vid = car["vehicle_id"]
    if car["year"] is None:
        years = catalog(car["make"], car["model"])
        if year in years:
            car["year"], vid = year, years[year]
        else:
            return {"make": car["make"], "model": car["model"], "year": None, "status": "NONE",
                    "needsYear": True, "years": sorted(years, reverse=True)}
    return picture({**car, "vehicle_id": vid}, {"make": car["make"], "model": car["model"], "year": car["year"], "status": "NONE"})


def picture(car: dict, result: dict) -> dict:
    """The picture of a catalog vehicle: start fetching it on first use and say where it stands."""
    vid = car["vehicle_id"]
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
