"""The car from its VIN: make, model, year and a studio picture (see modules/garage/car_picture)."""

import re

import httpx
from fastapi import APIRouter, Depends, Query, Response

from yazzy.modules.garage import car_picture
from yazzy.modules.identity.policy import authenticate, fail

router = APIRouter(prefix="/api/v1")


@router.get("/car-picture/{vin}")
def car_from_vin(
    vin: str,
    year: int | None = Query(None, ge=1950, le=2100),
    make: str | None = Query(None, max_length=60),
    model: str | None = Query(None, max_length=60),
    ctx=Depends(authenticate),
):
    """READY with a url, PENDING while the picture is fetched (ask again shortly), or NONE; needsYear asks the
    owner for the model year when the VIN has none, needsModel for the model when the VIN names none."""
    vin = vin.strip().upper()
    if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin):
        fail("INVALID_VIN", 422)
    try:
        return car_picture.lookup(vin, year, make, model)
    except httpx.HTTPError:
        fail("CAR_IMAGE_UNAVAILABLE", 502)


@router.get("/car-models")
def car_models(
    make: str = Query(min_length=1, max_length=60),
    year: int = Query(ge=1950, le=2100),
    ctx=Depends(authenticate),
):
    """The models the picture catalog has for a make in a year, for the owner to pick from."""
    try:
        return {"models": car_picture.models(make, year)}
    except httpx.HTTPError:
        fail("CAR_IMAGE_UNAVAILABLE", 502)


@router.get("/car-pictures/{vehicle_id}.webp")
def car_picture_file(vehicle_id: str):
    # No login, so the phone's image cache can load it directly; the id says nothing about anyone.
    if not re.fullmatch(r"veh_[a-z0-9]{6,40}", vehicle_id):
        fail("NOT_FOUND", 404)
    data = car_picture.image(vehicle_id)
    if data is None:
        fail("NOT_FOUND", 404)
    return Response(data, media_type="image/webp", headers={"Cache-Control": "public, max-age=2592000"})
