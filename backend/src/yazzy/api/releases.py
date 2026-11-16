"""Android self-update: build_apk.py --publish uploads the APK; the signed-in app checks and downloads it."""

import hashlib
import hmac
import secrets
import time

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select

from yazzy.config import settings
from yazzy.infrastructure.db import get_db
from yazzy.infrastructure.models import AppRelease
from yazzy.modules.identity.policy import authenticate, fail

router = APIRouter(prefix="/api/v1/app")
LINK_SECONDS = 900


def _key() -> bytes:
    return (settings.session_secret or settings.release_token or "development").encode()


def _signature(release_id: str, expires: int) -> str:
    return hmac.new(_key(), f"{release_id}:{expires}".encode(), hashlib.sha256).hexdigest()


@router.post("/releases", status_code=201)
async def publish(
    request: Request,
    version_code: int = Query(alias="versionCode", ge=1),
    version: str = Query(max_length=40),
    db=Depends(get_db, scope="function"),
):
    if not settings.release_token:
        fail("RELEASES_DISABLED", 404)
    if not secrets.compare_digest(
        request.headers.get("x-release-token", ""), settings.release_token
    ):
        fail("INVALID_RELEASE_TOKEN", 403)
    data = await request.body()
    if not data.startswith(b"PK"):
        fail("NOT_AN_APK", 400)
    db.execute(delete(AppRelease))
    release = AppRelease(
        version_code=version_code,
        version=version,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
    )
    db.add(release)
    db.flush()
    return {"versionCode": version_code, "version": version, "size": len(data)}


@router.get("/release")
def latest(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    release = db.scalars(
        select(AppRelease).order_by(AppRelease.version_code.desc()).limit(1)
    ).first()
    if not release:
        return {"versionCode": None}
    expires = int(time.time()) + LINK_SECONDS
    return {
        "versionCode": release.version_code,
        "version": release.version,
        "size": release.size,
        "sha256": release.sha256,
        # A short-lived signed link: the download runs outside the app's session cookie.
        "url": f"/api/v1/app/apk/{release.id}?exp={expires}&sig={_signature(release.id, expires)}",
    }


@router.get("/apk/{release_id}")
def download(
    release_id: str,
    exp: int,
    sig: str,
    db=Depends(get_db, scope="function"),
):
    if exp < time.time() or not hmac.compare_digest(sig, _signature(release_id, exp)):
        fail("LINK_EXPIRED", 403)
    release = db.get(AppRelease, release_id)
    if not release:
        fail("RELEASE_NOT_FOUND", 404)
    return Response(
        release.data,
        media_type="application/vnd.android.package-archive",
        headers={"Content-Disposition": f'attachment; filename="Yazzy-{release.version_code}.apk"'},
    )
