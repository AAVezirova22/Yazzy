import hashlib
import secrets
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Never

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from yazzy.config import settings
from yazzy.infrastructure.db import get_db, set_tenant
from yazzy.infrastructure.models import Audit, Device, LoginSession, Membership, Vehicle


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def fail(code: str, status=400) -> Never:
    raise HTTPException(status, detail={"code": code})


@dataclass(frozen=True)
class Context:
    tenant_id: str
    subject: str
    role: str
    vehicle_ids: tuple[str, ...] = ()


MANAGERS = {"OWNER", "FLEET_OWNER", "FLEET_MANAGER"}


def require_role(ctx: Context, roles=MANAGERS):
    if ctx.role not in roles:
        fail("ROLE_ACCESS_DENIED", 403)


def vehicle_scope(query, ctx):
    query = query.where(Vehicle.tenant_id == ctx.tenant_id)
    if ctx.role not in MANAGERS:
        query = query.where(Vehicle.id.in_(ctx.vehicle_ids))
    return query


def vehicle(db, ctx, vehicle_id, *, write=False):
    if write:
        require_role(ctx)
    found = db.scalar(vehicle_scope(select(Vehicle).where(Vehicle.id == vehicle_id), ctx))
    if found is None:
        fail("VEHICLE_NOT_FOUND", 404)
    return found


def scoped(db, cls, ctx, record_id):
    record = db.scalar(select(cls).where(cls.id == record_id, cls.tenant_id == ctx.tenant_id))
    if record is None:
        fail("RESOURCE_NOT_FOUND", 404)
    if hasattr(record, "vehicle_id"):
        vehicle(db, ctx, record.vehicle_id)
    return record


def audit(db, ctx, action, resource_id, detail=None):
    db.add(
        Audit(
            tenant_id=ctx.tenant_id,
            actor=ctx.subject,
            action=action,
            resource_id=resource_id,
            detail=detail or {},
        )
    )


def new_session(db, membership, lifetime: float = 3600 * 8):
    token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(24)
    db.add(
        LoginSession(
            token_hash=digest(token),
            membership_id=membership.id,
            csrf=csrf,
            expires_at=time.time() + lifetime,
        )
    )
    return token, csrf


@lru_cache(maxsize=8)
def signing_keys(issuer: str):
    discovery = (
        httpx.get(issuer.rstrip("/") + "/.well-known/openid-configuration", timeout=5)
        .raise_for_status()
        .json()
    )
    if discovery.get("issuer") != issuer or not discovery.get("jwks_uri", "").startswith(
        "https://"
    ):
        raise ValueError("Invalid OIDC discovery")
    return jwt.PyJWKClient(discovery["jwks_uri"], timeout=5)


def authenticate(request: Request, db=Depends(get_db, scope="function")) -> Context:
    bearer = request.headers.get("authorization", "")
    if bearer.startswith("Bearer ") and "." not in bearer[7:]:
        # An account's app token (see yazzy.api.accounts): opaque, so never a JWT. Sent as a header, never as a
        # cookie, so it needs no CSRF token.
        session = db.get(LoginSession, digest(bearer[7:]))
        if not session or session.expires_at < time.time():
            fail("AUTHENTICATION_REQUIRED", 401)
        member = db.get(Membership, session.membership_id)
    elif bearer.startswith("Bearer ") and settings.oidc_issuer:
        try:
            client = signing_keys(settings.oidc_issuer)
            token = bearer[7:]
            key = client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256", "ES256"],
                audience=settings.oidc_audience,
                issuer=settings.oidc_issuer,
                options={"require": ["sub", "exp", "iat", "iss", "aud"]},
            )
            members = list(
                db.scalars(
                    select(Membership).where(
                        Membership.subject == claims["sub"], Membership.active.is_(True)
                    )
                )
            )
            selected = request.headers.get("x-organisation-id")
            member = next((m for m in members if selected is None or m.tenant_id == selected), None)
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, KeyError):
            fail("INVALID_TOKEN", 401)
    else:
        token = request.cookies.get("yazzy_session", "")
        session = db.get(LoginSession, digest(token))
        if not session or session.expires_at < time.time():
            fail("AUTHENTICATION_REQUIRED", 401)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
                fail("CSRF_FAILED", 403)
            if request.headers.get("origin") not in {None, *settings.allowed_web_origins}:
                fail("ORIGIN_DENIED", 403)
        member = db.get(Membership, session.membership_id)
    if member is None or not member.active:
        fail("MEMBERSHIP_REVOKED", 403)
    set_tenant(db, member.tenant_id)
    return Context(member.tenant_id, member.subject, member.role, tuple(member.vehicle_ids))


def device_auth(request: Request, db=Depends(get_db, scope="function")) -> Device:
    header = request.headers.get("authorization", "")
    if not header.startswith("Device "):
        fail("DEVICE_AUTH_REQUIRED", 401)
    device = db.scalar(select(Device).where(Device.token_hash == digest(header[7:])))
    if not device or device.revoked:
        fail("DEVICE_REVOKED_OR_UNKNOWN", 401)
    set_tenant(db, device.tenant_id)
    return device
