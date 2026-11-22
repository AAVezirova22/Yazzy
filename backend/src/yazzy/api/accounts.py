"""Accounts: register and sign in with e-mail and password; the app keeps a long-lived token for fingerprint and
face unlock on the phone.

Each account owns one workspace (an organisation) and is its OWNER. The first account registered from a phone
that is signed in to the shared "personal-sandbox" workspace (the app before accounts existed) takes that
workspace over, so its car and trips stay; every other account starts with an empty garage.
"""

import hashlib
import hmac
import re
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from yazzy.infrastructure.db import get_db
from yazzy.infrastructure.models import Account, LoginSession, Membership, Organisation
from yazzy.modules.identity.policy import authenticate, digest, fail, new_session

router = APIRouter(prefix="/api/v1/auth")
TOKEN_DAYS = 180
SHARED = "personal-sandbox"
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


class Register(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(default="", max_length=80)
    # Ask to keep the shared workspace this phone is signed in to (the request must carry that session).
    claim: bool = False


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${key.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, key = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got.hex(), key)
    except (ValueError, TypeError):
        return False


def subject(account: Account) -> str:
    return f"account:{account.id}"


def throttle(request: Request):
    from yazzy.api.main import login_locked

    address = request.client.host if request.client else "unknown"
    wait = login_locked(address)
    if wait:
        raise HTTPException(429, {"code": "TOO_MANY_ATTEMPTS", "retryAfter": wait}, headers={"Retry-After": str(wait)})
    return address


def shared_session(request: Request, db) -> bool:
    """Whether the request carries a live session of the shared workspace, with its CSRF token."""
    session = db.get(LoginSession, digest(request.cookies.get("yazzy_session", "")))
    if not session or session.expires_at < time.time():
        return False
    if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
        return False
    member = db.get(Membership, session.membership_id)
    return bool(member and member.tenant_id == SHARED)


def signed_in(db, account: Account, member: Membership, new: bool) -> dict:
    token, _ = new_session(db, member, lifetime=TOKEN_DAYS * 86400)
    return {"token": token, "account": {"id": account.id, "email": account.email, "name": account.name},
            "tenantId": member.tenant_id, "new": new}


@router.post("/register", status_code=201)
def register(data: Register, request: Request, db=Depends(get_db, scope="function")):
    throttle(request)
    email = data.email.strip().lower()
    if not EMAIL.match(email):
        fail("INVALID_EMAIL", 422)
    if db.scalar(select(Account).where(Account.email == email)):
        fail("EMAIL_TAKEN", 409)
    account = Account(email=email, name=data.name.strip(), password_hash=hash_password(data.password))
    db.add(account)
    db.flush()
    claimed = db.scalar(
        select(Membership).where(Membership.tenant_id == SHARED, Membership.subject.like("account:%")).limit(1)
    )
    if data.claim and not claimed and db.get(Organisation, SHARED) and shared_session(request, db):
        tenant = SHARED
    else:
        org = Organisation(name=f"{account.name}'s garage" if account.name else "My garage")
        db.add(org)
        db.flush()
        tenant = org.id
    member = Membership(subject=subject(account), tenant_id=tenant, role="OWNER")
    db.add(member)
    db.flush()
    return signed_in(db, account, member, new=True)


@router.post("/login")
def login(data: Login, request: Request, db=Depends(get_db, scope="function")):
    from yazzy.api.main import login_failed

    address = throttle(request)
    account = db.scalar(select(Account).where(Account.email == data.email.strip().lower()))
    if not account or not check_password(data.password, account.password_hash):
        login_failed(address)
        time.sleep(1)  # slows password guessing; runs in the threadpool
        fail("INVALID_LOGIN", 401)
    member = db.scalar(select(Membership).where(Membership.subject == subject(account), Membership.active.is_(True)))
    if not member:
        fail("MEMBERSHIP_REVOKED", 403)
    return signed_in(db, account, member, new=False)


@router.get("/account")
def whoami(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    if not ctx.subject.startswith("account:"):
        return {"account": None, "tenantId": ctx.tenant_id}
    account = db.get(Account, ctx.subject.removeprefix("account:"))
    return {"account": {"id": account.id, "email": account.email, "name": account.name} if account else None,
            "tenantId": ctx.tenant_id}


@router.post("/sign-out")
def sign_out(request: Request, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    bearer = request.headers.get("authorization", "")
    if bearer.startswith("Bearer "):
        session = db.get(LoginSession, digest(bearer[7:]))
        if session:
            db.delete(session)
    return {"signedOut": True}
