"""Android self-update. APKs live in the GitHub release `android`, never in the database.

scripts/build_apk.py --publish uploads `Yazzy-<build>.apk` and the manifest `yazzy-android.json`
there. New apps read the manifest from GitHub themselves. These two routes only bridge builds 37 and
older, which ask this API: they get the manifest here and are redirected to GitHub for the file.
"""

import re
import threading
import time

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse

from yazzy.config import settings
from yazzy.modules.identity.policy import authenticate, fail

router = APIRouter(prefix="/api/v1/app")
MANIFEST = "yazzy-android.json"
FRESH_SECONDS = 300
# After a failed look-up, wait this long before asking GitHub again.
RETRY_SECONDS = 60
_cache = {"at": 0.0, "ok": False, "manifest": None}
_lock = threading.Lock()


def fetch_manifest() -> dict:
    response = httpx.get(f"{settings.updates_url}/{MANIFEST}", follow_redirects=True, timeout=10)
    response.raise_for_status()
    return response.json()


def manifest() -> dict | None:
    """The newest published build, cached so app launches don't each reach GitHub."""
    with _lock:
        age = time.time() - _cache["at"]
        if age < (FRESH_SECONDS if _cache["ok"] else RETRY_SECONDS):
            return _cache["manifest"]
        try:
            found = fetch_manifest()
            valid = (
                isinstance(found.get("versionCode"), int)
                and isinstance(found.get("apk"), str)
                and re.fullmatch(r"[\w.-]+\.apk", found["apk"])
            )
            _cache.update(at=time.time(), ok=True, manifest=found if valid else None)
        except (httpx.HTTPError, ValueError):
            # Keep offering the last known build while GitHub can't be reached.
            _cache.update(at=time.time(), ok=False)
        return _cache["manifest"]


@router.get("/release")
def latest(ctx=Depends(authenticate)):
    found = manifest()
    if not found:
        return {"versionCode": None}
    return {
        "versionCode": found["versionCode"],
        "version": found.get("version"),
        "size": found.get("size"),
        "sha256": found.get("sha256"),
        # Relative: builds 37 and older put this API's address in front of it.
        "url": "/api/v1/app/apk",
    }


@router.get("/apk")
def download():
    found = manifest()
    if not found:
        fail("RELEASE_NOT_FOUND", 404)
    return RedirectResponse(f"{settings.updates_url}/{found['apk']}", status_code=302)
