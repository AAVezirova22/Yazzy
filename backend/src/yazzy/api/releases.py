"""Android self-update: build_apk.py --publish uploads the APK in parts; the signed-in app downloads it.

Upload: POST /releases (metadata), PUT /releases/{id}/parts/{n} (each <= PART_BYTES), then
POST /releases/{id}/complete. The free host has 512 MB of memory, so neither direction ever
holds the whole APK at once.
"""

import hashlib
import hmac
import secrets
import time

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from yazzy.config import settings
from yazzy.infrastructure.db import Session, get_db
from yazzy.infrastructure.http_limits import RELEASE_PART_BYTES
from yazzy.infrastructure.models import AppRelease, AppReleasePart
from yazzy.modules.identity.policy import authenticate, fail

router = APIRouter(prefix="/api/v1/app")
PART_BYTES = 4 * 1024 * 1024
assert PART_BYTES < RELEASE_PART_BYTES
MAX_APK_BYTES = 150_000_000
LINK_SECONDS = 900


class NewRelease(BaseModel):
    versionCode: int = Field(ge=1)
    version: str = Field(max_length=40)
    size: int = Field(gt=0, le=MAX_APK_BYTES)
    sha256: str = Field(pattern="^[0-9a-f]{64}$")


def _publisher(request: Request):
    if not settings.release_token:
        fail("RELEASES_DISABLED", 404)
    if not secrets.compare_digest(
        request.headers.get("x-release-token", ""), settings.release_token
    ):
        fail("INVALID_RELEASE_TOKEN", 403)


def _key() -> bytes:
    return (settings.session_secret or settings.release_token or "development").encode()


def _signature(release_id: str, expires: int) -> str:
    return hmac.new(_key(), f"{release_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def _pending(db, release_id: str) -> AppRelease:
    release = db.get(AppRelease, release_id)
    if not release or release.complete:
        fail("RELEASE_NOT_FOUND", 404)
    return release


def _part(db, release_id: str, index: int) -> bytes:
    return db.scalar(
        select(AppReleasePart.data).where(
            AppReleasePart.release_id == release_id, AppReleasePart.index == index
        )
    )


def _drop(db, condition):
    ids = select(AppRelease.id).where(condition)
    db.execute(delete(AppReleasePart).where(AppReleasePart.release_id.in_(ids)))
    db.execute(delete(AppRelease).where(condition))


@router.post("/releases", status_code=201, dependencies=[Depends(_publisher)])
def start(data: NewRelease, db=Depends(get_db, scope="function")):
    # Drop abandoned uploads; the live release stays until the new one completes.
    _drop(db, AppRelease.complete.is_(False))
    release = AppRelease(
        version_code=data.versionCode, version=data.version, size=data.size, sha256=data.sha256
    )
    db.add(release)
    db.flush()
    return {"id": release.id, "partBytes": PART_BYTES}


@router.put("/releases/{release_id}/parts/{index}", dependencies=[Depends(_publisher)])
async def upload_part(
    release_id: str, index: int, request: Request, db=Depends(get_db, scope="function")
):
    data = await request.body()
    if not data or len(data) > PART_BYTES or index < 0:
        fail("INVALID_PART", 400)
    _pending(db, release_id)
    db.merge(AppReleasePart(release_id=release_id, index=index, data=data))
    return {"index": index, "size": len(data)}


@router.post("/releases/{release_id}/complete", dependencies=[Depends(_publisher)])
def complete(release_id: str, db=Depends(get_db, scope="function")):
    release = _pending(db, release_id)
    indexes = list(
        db.scalars(
            select(AppReleasePart.index)
            .where(AppReleasePart.release_id == release_id)
            .order_by(AppReleasePart.index)
        )
    )
    if not indexes or indexes != list(range(len(indexes))):
        fail("MISSING_PARTS", 409)
    digest, size = hashlib.sha256(), 0
    for index in indexes:
        chunk = _part(db, release_id, index)
        digest.update(chunk)
        size += len(chunk)
    if size != release.size or digest.hexdigest() != release.sha256:
        fail("CHECKSUM_MISMATCH", 409)
    _drop(db, AppRelease.id != release_id)
    release.complete = True
    return {"versionCode": release.version_code, "size": size}


@router.get("/release")
def latest(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    release = db.scalars(
        select(AppRelease)
        .where(AppRelease.complete.is_(True))
        .order_by(AppRelease.version_code.desc())
        .limit(1)
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
def download(release_id: str, exp: int, sig: str, db=Depends(get_db, scope="function")):
    if exp < time.time() or not hmac.compare_digest(sig, _signature(release_id, exp)):
        fail("LINK_EXPIRED", 403)
    release = db.get(AppRelease, release_id)
    if not release or not release.complete:
        fail("RELEASE_NOT_FOUND", 404)
    count = db.scalar(
        select(func.count())
        .select_from(AppReleasePart)
        .where(AppReleasePart.release_id == release_id)
    )

    def stream():
        # Own session, because the request's session closes before the body streams.
        with Session() as parts:
            for index in range(count):
                yield _part(parts, release_id, index)

    return StreamingResponse(
        stream(),
        media_type="application/vnd.android.package-archive",
        headers={
            "Content-Length": str(release.size),
            "Content-Disposition": f'attachment; filename="Yazzy-{release.version_code}.apk"',
        },
    )
