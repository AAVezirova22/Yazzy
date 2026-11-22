import json
import logging
import secrets
import threading
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from starlette.middleware.sessions import SessionMiddleware

from yazzy.api.schemas import (
    AdvisorInput,
    AssignmentInput,
    CorrectionInput,
    Enrollment,
    ExportInput,
    FuelInput,
    MaintenanceInput,
    PrivacyInput,
    QuoteInput,
    RebuildInput,
    VehicleInput,
    VehiclePatch,
    WorkOrderInput,
    WorkOrderPatch,
)
from yazzy.config import settings
from yazzy.infrastructure.db import get_db
from yazzy.infrastructure.models import (
    Assignment,
    Audit,
    Baseline,
    Device,
    Finding,
    FuelEntry,
    Job,
    LoginSession,
    Maintenance,
    Membership,
    Organisation,
    PendingAction,
    Preference,
    Quote,
    Revision,
    Sample,
    SimulationRun,
    Trip,
    Vehicle,
    WorkOrder,
    uid,
)
from yazzy.modules.advisor.service import answer, review_quote
from yazzy.modules.fleet.service import overview, serialize
from yazzy.modules.identity.policy import (
    audit,
    authenticate,
    device_auth,
    digest,
    fail,
    new_session,
    require_role,
    scoped,
    vehicle,
    vehicle_scope,
)
from yazzy.modules.telemetry.contracts import SIGNALS, TelemetryBatch
from yazzy.modules.telemetry.service import ingest
from yazzy.modules.trips.domain import aggregate
from yazzy.modules.trips.service import recent_ranges

logger = logging.getLogger("yazzy.api")


@asynccontextmanager
async def lifespan(app):
    settings.validate()
    stop = None
    if settings.embedded_worker:
        from yazzy.workers.runner import start_embedded

        stop = start_embedded()
    try:
        yield
    finally:
        if stop:
            stop()


app = FastAPI(title="Yazzy vehicle intelligence", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_web_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-CSRF-Token",
        "X-Organisation-Id",
        "Idempotency-Key",
        "X-Access-Password",
    ],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret or secrets.token_urlsafe(32),
    https_only=settings.environment == "production",
    same_site="lax",
)


from yazzy.infrastructure.http_limits import RequestLimits  # noqa: E402

app.add_middleware(RequestLimits)


@app.middleware("http")
async def guard(request: Request, call_next):
    request_id = secrets.token_hex(12)
    start = time.monotonic()
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse({"detail": {"code": "INVALID_CONTENT_LENGTH"}}, status_code=400)
    if length > 1_000_000:
        return JSONResponse({"detail": {"code": "PAYLOAD_TOO_LARGE"}}, status_code=413)
    response = await call_next(request)
    if settings.embedded_worker and request.method != "GET":
        from yazzy.workers.runner import wake_embedded

        wake_embedded()
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        json.dumps(
            {
                "requestId": request_id,
                "method": request.method,
                "status": response.status_code,
                "durationMs": round((time.monotonic() - start) * 1000, 2),
            }
        )
    )
    return response


@app.exception_handler(IntegrityError)
async def conflict(_request, _exception):
    return JSONResponse(status_code=409, content={"detail": {"code": "CONCURRENT_WRITE_CONFLICT"}})


# Unexpected failures still answer 500, but name the kind of error (never its message, which can
# hold data), so the phone can show why an upload failed instead of a bare status code.
@app.exception_handler(DBAPIError)
async def database_error(_request, exception):
    logger.exception("database error", exc_info=exception)
    reason = type(getattr(exception, "orig", None) or exception).__name__
    return JSONResponse(
        status_code=500, content={"detail": {"code": "DATABASE_ERROR", "reason": reason}}
    )


@app.exception_handler(Exception)
async def server_error(_request, exception):
    logger.exception("unhandled error", exc_info=exception)
    reason = type(exception).__name__
    return JSONResponse(
        status_code=500, content={"detail": {"code": "SERVER_ERROR", "reason": reason}}
    )


@app.get("/ping")
def ping():
    """Liveness without touching the database, so host health checks do not wake it."""
    return {"status": "ok"}


@app.get("/health")
def health(db=Depends(get_db, scope="function")):
    db.execute(select(1))
    return {"status": "ok", "version": "0.1.0", "hardwareVerified": False}


@app.get("/api/v1/auth/config")
def auth_config():
    return {
        "demoEnabled": settings.demo_enabled and settings.environment != "production",
        "oidcEnabled": bool(settings.oidc_issuer),
        "passwordRequired": bool(settings.access_password),
    }


# The access password may be as short as 4 characters, so wrong guesses are capped: a few per
# address, and a few dozen an hour from everywhere together, which keeps even a 4-digit code out of
# reach of a bot. While locked, the right password is refused too, or guessing could go on.
FAILURES_PER_ADDRESS, ADDRESS_WINDOW = 5, 900
FAILURES_OVERALL, OVERALL_WINDOW = 20, 3600
_failures: deque[tuple[float, str]] = deque()
_failures_lock = threading.Lock()


def login_locked(address: str) -> int:
    """Seconds until a login from `address` may be tried again (0: now)."""
    now = time.time()
    with _failures_lock:
        while _failures and _failures[0][0] < now - OVERALL_WINDOW:
            _failures.popleft()
        waits = []
        mine = [t for t, a in _failures if a == address and t >= now - ADDRESS_WINDOW]
        if len(mine) >= FAILURES_PER_ADDRESS:
            waits.append(mine[-FAILURES_PER_ADDRESS] + ADDRESS_WINDOW - now)
        if len(_failures) >= FAILURES_OVERALL:
            waits.append(_failures[-FAILURES_OVERALL][0] + OVERALL_WINDOW - now)
        return max(0, int(max(waits, default=0)) + (1 if waits else 0))


def login_failed(address: str):
    with _failures_lock:
        _failures.append((time.time(), address))


@app.post("/api/v1/auth/demo")
def demo_login(
    request: Request, response: Response, mode: str = "fleet", db=Depends(get_db, scope="function")
):
    if not settings.demo_enabled or settings.environment == "production":
        fail("DEMO_DISABLED", 404)
    if request.headers.get("origin") not in {None, *settings.allowed_web_origins}:
        fail("ORIGIN_DENIED", 403)
    if settings.access_password:
        address = request.client.host if request.client else "unknown"
        wait = login_locked(address)
        if wait:
            raise HTTPException(
                429,
                {"code": "TOO_MANY_ATTEMPTS", "retryAfter": wait},
                headers={"Retry-After": str(wait)},
            )
        supplied = request.headers.get("x-access-password", "")
        if not secrets.compare_digest(supplied.encode(), settings.access_password.encode()):
            login_failed(address)
            time.sleep(1)  # throttle guessing; this endpoint runs in the threadpool
            fail("ACCESS_PASSWORD_REQUIRED", 401)
    if mode not in {"fleet", "personal"}:
        fail("INVALID_MODE", 422)
    tenant = "demo-mobility" if mode == "fleet" else "personal-sandbox"
    member = db.scalar(
        select(Membership).where(
            Membership.tenant_id == tenant, Membership.subject == f"local-{mode}"
        )
    )
    if not member:
        fail("RUN_BOOTSTRAP_FIRST", 503)
    token, csrf = new_session(db, member)
    response.set_cookie(
        "yazzy_session",
        token,
        httponly=True,
        samesite="lax",
        secure=settings.environment != "development",
        max_age=28800,
    )
    return {"csrfToken": csrf, "tenantId": tenant, "role": member.role}


@app.get("/api/v1/auth/me")
def me(request: Request, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    session = db.get(LoginSession, digest(request.cookies.get("yazzy_session", "")))
    org = db.get(Organisation, ctx.tenant_id)
    return {
        "subject": ctx.subject,
        "tenantId": ctx.tenant_id,
        "role": ctx.role,
        "organisation": org.name,
        "isDemo": org.is_demo,
        "csrfToken": session.csrf if session else None,
    }


@app.post("/api/v1/auth/logout")
def logout(
    request: Request,
    response: Response,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    db.execute(
        delete(LoginSession).where(
            LoginSession.token_hash == digest(request.cookies.get("yazzy_session", ""))
        )
    )
    response.delete_cookie("yazzy_session")
    return {"loggedOut": True}


# OIDC web BFF: provider tokens stay server-side; browser receives opaque HttpOnly session.
@app.get("/api/v1/auth/login")
async def oidc_login(request: Request):
    if not settings.oidc_issuer:
        fail("OIDC_NOT_CONFIGURED", 503)
    from authlib.integrations.starlette_client import OAuth

    oauth = OAuth()
    client = oauth.register(
        "provider",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
    )
    return await client.authorize_redirect(request, str(request.url_for("oidc_callback")))


@app.get("/api/v1/auth/callback")
async def oidc_callback(request: Request, db=Depends(get_db, scope="function")):
    from authlib.integrations.starlette_client import OAuth
    from fastapi.responses import RedirectResponse

    oauth = OAuth()
    client = oauth.register(
        "provider",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
    )
    token = await client.authorize_access_token(request)
    claims = token.get("userinfo")
    if not claims:
        fail("OIDC_IDENTITY_MISSING", 401)
    member = db.scalar(
        select(Membership).where(Membership.subject == claims["sub"], Membership.active.is_(True))
    )
    if not member:
        fail("MEMBERSHIP_REQUIRED", 403)
    opaque, _ = new_session(db, member)
    response = RedirectResponse(settings.web_origin)
    response.set_cookie(
        "yazzy_session",
        opaque,
        secure=settings.environment == "production",
        httponly=True,
        samesite="lax",
        max_age=28800,
    )
    return response


@app.get("/api/v1/vehicles")
def list_vehicles(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    return [
        serialize(v)
        for v in db.scalars(
            vehicle_scope(select(Vehicle), ctx)
            .order_by(Vehicle.created_at)
            .offset(offset)
            .limit(limit)
        )
    ]


@app.post("/api/v1/vehicles", status_code=201)
def add_vehicle(
    data: VehicleInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
):
    require_role(ctx)
    org = db.get(Organisation, ctx.tenant_id)
    v = Vehicle(
        tenant_id=ctx.tenant_id,
        **data.model_dump(),
        origin="SIMULATED" if org.is_demo else "REAL",
        capabilities={
            "verificationStatus": "PENDING_DEVICE_TEST",
            "supportedSignals": [],
            "backgroundRecording": "NOT_VERIFIED",
            "crankingVoltage": "NOT_VERIFIED",
        },
    )
    db.add(v)
    db.flush()
    audit(db, ctx, "VEHICLE_CREATED", v.id)
    return serialize(v)


@app.get("/api/v1/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    return serialize(vehicle(db, ctx, vehicle_id))


@app.patch("/api/v1/vehicles/{vehicle_id}")
def patch_vehicle(
    vehicle_id: str,
    data: VehiclePatch,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    v = vehicle(db, ctx, vehicle_id, write=True)
    if data.version != v.version:
        fail("STALE_VERSION", 409)
    for key, val in data.model_dump(exclude_unset=True).items():
        if key != "version":
            setattr(v, key, val)
    v.version += 1
    audit(db, ctx, "VEHICLE_UPDATED", v.id)
    return serialize(v)


@app.get("/api/v1/vehicles/{vehicle_id}/capabilities")
def capabilities(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    v = vehicle(db, ctx, vehicle_id)
    return {
        "adapterModel": "VGATE_ICAR_PRO_BT4" if v.origin == "REAL" else "VIRTUAL_DEVICE",
        "dataOrigin": v.origin,
        **v.capabilities,
    }


@app.post("/api/v1/devices/enrolments", status_code=201)
def enrol(data: Enrollment, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    v = vehicle(db, ctx, data.vehicle_id, write=True)
    if v.origin != "REAL":
        fail("USE_SIMULATOR_ENROLMENT", 409)
    token = secrets.token_urlsafe(40)
    d = Device(
        tenant_id=ctx.tenant_id,
        name=data.name,
        token_hash=digest(token),
        origin="REAL",
        source="MOBILE_OBD",
    )
    db.add(d)
    db.flush()
    # Re-enrolling a phone (after a reinstall its saved token is gone) replaces the vehicle's previous phone recorder.
    a = create_assignment(db, ctx, d, v, time.time(), replace_source="MOBILE_OBD")
    audit(db, ctx, "DEVICE_ENROLLED", d.id)
    return {"deviceId": d.id, "assignmentId": a.id, "deviceToken": token, "validFrom": a.valid_from}


def create_assignment(db, ctx, d, v, start, replace_source=None):
    db.execute(select(Device).where(Device.id == d.id).with_for_update())
    db.execute(select(Vehicle).where(Vehicle.id == v.id).with_for_update())
    active = list(
        db.scalars(
            select(Assignment).where(
                Assignment.tenant_id == ctx.tenant_id,
                Assignment.valid_until.is_(None),
                (Assignment.device_id == d.id) | (Assignment.vehicle_id == v.id),
            )
        )
    )
    for previous in active:
        if previous.vehicle_id == v.id and previous.device_id != d.id:
            other = db.get(Device, previous.device_id)
            if not (replace_source and other and other.source == replace_source):
                fail("PRIMARY_SOURCE_ALREADY_ASSIGNED", 409)
            other.revoked = True
            audit(db, ctx, "DEVICE_REPLACED", other.id)
        if start <= previous.valid_from:
            fail("OVERLAPPING_ASSIGNMENT", 409)
        previous.valid_until = start
    a = Assignment(tenant_id=ctx.tenant_id, device_id=d.id, vehicle_id=v.id, valid_from=start)
    db.add(a)
    db.flush()
    return a


@app.get("/api/v1/devices")
def devices(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    require_role(ctx)
    return [
        serialize(d)
        for d in db.scalars(select(Device).where(Device.tenant_id == ctx.tenant_id).limit(100))
    ]


@app.post("/api/v1/devices/{device_id}/assignments")
def assign(
    device_id: str,
    data: AssignmentInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    require_role(ctx)
    d = scoped(db, Device, ctx, device_id)
    v = vehicle(db, ctx, data.vehicle_id, write=True)
    if d.origin != v.origin or abs(data.valid_from - time.time()) > 120:
        fail("INVALID_ASSIGNMENT_ORIGIN_OR_TIME", 422)
    a = create_assignment(db, ctx, d, v, data.valid_from)
    audit(db, ctx, "DEVICE_ASSIGNED", d.id)
    return serialize(a)


@app.post("/api/v1/devices/{device_id}/revoke")
def revoke_device(device_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    require_role(ctx)
    d = scoped(db, Device, ctx, device_id)
    d.revoked = True
    audit(db, ctx, "DEVICE_REVOKED", d.id)
    return {"revoked": True}


@app.post("/api/v1/telemetry/batches", status_code=202)
def batches(
    data: TelemetryBatch, device=Depends(device_auth), db=Depends(get_db, scope="function")
):
    return ingest(db, device, data)


@app.get("/api/v1/vehicles/{vehicle_id}/telemetry")
def telemetry(
    vehicle_id: str,
    from_at: float | None = Query(None, alias="from"),
    to_at: float | None = Query(None, alias="to"),
    resolution: int = Query(300, ge=10, le=1000),
    signal: str = "VEHICLE_SPEED",
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    vehicle(db, ctx, vehicle_id)
    if signal not in SIGNALS:
        fail("UNKNOWN_SIGNAL", 422)
    latest = (
        db.scalar(
            select(func.max(Sample.observed_at)).where(
                Sample.tenant_id == ctx.tenant_id, Sample.vehicle_id == vehicle_id
            )
        )
        or time.time()
    )
    end = to_at if to_at is not None else latest + 1
    start = from_at if from_at is not None else end - 86400
    if end <= start or end - start > 31 * 86400:
        fail("BOUNDED_RANGE_REQUIRED", 422)
    # Only the columns a chart point needs: whole rows (six IDs and a hash each) made every
    # opened trip move about eight times more data out of the database, which is metered.
    rows = db.execute(
        select(Sample.observed_at, Sample.value, Sample.quality, Sample.origin)
        .where(
            Sample.tenant_id == ctx.tenant_id,
            Sample.vehicle_id == vehicle_id,
            Sample.signal == signal,
            Sample.observed_at >= start,
            Sample.observed_at < end,
        )
        .order_by(Sample.observed_at)
        .limit(50001)
    ).all()
    if len(rows) > 50000:
        fail("REDUCE_QUERY_WINDOW", 422)
    stride = max(1, (len(rows) + resolution - 1) // resolution)
    points: list[dict[str, Any]] = []
    for index in range(0, len(rows), stride):
        bucket = rows[index : index + stride]
        numeric = [
            i
            for i, s in enumerate(bucket)
            if isinstance(s.value, (float, int)) and s.quality == "VALID"
        ]
        chosen = (
            sorted(
                {
                    min(numeric, key=lambda i: bucket[i].value),
                    max(numeric, key=lambda i: bucket[i].value),
                }
            )
            if numeric
            else [0]
        )
        points.extend(
            {
                "observedAt": bucket[i].observed_at,
                "value": bucket[i].value,
                "quality": bucket[i].quality,
                "origin": bucket[i].origin,
            }
            for i in chosen
        )
    return {
        "signal": signal,
        "unit": SIGNALS[signal][0],
        "points": points,
        "rawCount": len(rows),
        "from": start,
        "to": end,
        "method": "MIN_MAX_BUCKETS",
    }


@app.get("/api/v1/vehicles/{vehicle_id}/trips")
def trips(
    vehicle_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    vehicle(db, ctx, vehicle_id)
    return [
        serialize(t)
        for t in db.scalars(
            select(Trip)
            .where(Trip.tenant_id == ctx.tenant_id, Trip.vehicle_id == vehicle_id)
            .order_by(Trip.start_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ]


@app.get("/api/v1/trips/{trip_id}")
def trip_detail(trip_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    return serialize(scoped(db, Trip, ctx, trip_id))


@app.post("/api/v1/trips/{trip_id}/corrections", status_code=202)
def corrections(
    trip_id: str,
    data: CorrectionInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    t = scoped(db, Trip, ctx, trip_id)
    vehicle(db, ctx, t.vehicle_id, write=True)
    payload = {"sessionId": t.session_id, "reason": data.reason}
    if data.type == "SPLIT":
        if data.at is None or not t.start_at < data.at < t.end_at:
            fail("INVALID_SPLIT", 422)
        payload["at"] = data.at
    else:
        other = scoped(db, Trip, ctx, data.other_trip_id)
        if other.session_id != t.session_id or other.vehicle_id != t.vehicle_id or other.id == t.id:
            fail("INVALID_MERGE", 422)
        payload.update(start=min(t.start_at, other.start_at), end=max(t.end_at, other.end_at))
    revision = Revision(
        tenant_id=ctx.tenant_id,
        vehicle_id=t.vehicle_id,
        actor=ctx.subject,
        kind=data.type,
        payload=payload,
    )
    db.add(revision)
    db.flush()
    run = db.get(SimulationRun, t.run_id) if t.run_id else None
    job = Job(
        tenant_id=ctx.tenant_id,
        kind="RECONCILE",
        key="revision:" + revision.id,
        payload={
            "vehicleId": t.vehicle_id,
            "runId": t.run_id,
            "runGeneration": run.generation if run else None,
            "ranges": [
                {
                    "deviceId": t.device_id,
                    "sessionId": t.session_id,
                    "from": payload.get("start", t.start_at),
                    "to": payload.get("end", t.end_at),
                }
            ],
        },
    )
    db.add(job)
    db.flush()
    audit(db, ctx, "TRIP_CORRECTED", t.id)
    return {"jobId": job.id, "revisionId": revision.id}


@app.post("/api/v1/vehicles/{vehicle_id}/trips/rebuild", status_code=202)
def rebuild_trips(
    vehicle_id: str,
    data: RebuildInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    """Rebuilds the trips of every recording in the last `days` from the stored readings, for
    drives whose trips were never made (for example while trip building was failing)."""
    v = vehicle(db, ctx, vehicle_id, write=True)
    ranges = recent_ranges(db, ctx.tenant_id, v.id, None, time.time() - data.days * 86400)
    job = Job(
        tenant_id=ctx.tenant_id,
        kind="RECONCILE",
        key=f"rebuild:{v.id}:{uuid.uuid4()}",
        payload={"vehicleId": v.id, "runId": None, "runGeneration": None, "ranges": ranges},
    )
    db.add(job)
    db.flush()
    audit(db, ctx, "TRIPS_REBUILT", v.id)
    return {"jobId": job.id, "sessions": len(ranges)}


@app.get("/api/v1/vehicles/{vehicle_id}/fuel-entries")
def fuel_entries(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    vehicle(db, ctx, vehicle_id)
    return [
        serialize(f)
        for f in db.scalars(
            select(FuelEntry)
            .where(FuelEntry.tenant_id == ctx.tenant_id, FuelEntry.vehicle_id == vehicle_id)
            .order_by(FuelEntry.observed_at.desc())
            .limit(200)
        )
    ]


@app.post("/api/v1/vehicles/{vehicle_id}/fuel-entries", status_code=201)
def add_fuel(
    vehicle_id: str,
    data: FuelInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    vehicle(db, ctx, vehicle_id, write=True)
    prior = db.scalar(
        select(FuelEntry).where(
            FuelEntry.tenant_id == ctx.tenant_id, FuelEntry.idempotency_key == data.idempotency_key
        )
    )
    if prior:
        if prior.vehicle_id != vehicle_id or any(
            getattr(prior, k) != v for k, v in data.model_dump().items()
        ):
            fail("IDEMPOTENCY_CONFLICT", 409)
        return serialize(prior)
    entry = FuelEntry(tenant_id=ctx.tenant_id, vehicle_id=vehicle_id, **data.model_dump())
    db.add(entry)
    db.flush()
    audit(db, ctx, "FUEL_PURCHASE_RECORDED", entry.id)
    return serialize(entry)


@app.get("/api/v1/vehicles/{vehicle_id}/fuel-report")
def fuel_report(
    vehicle_id: str,
    from_at: float | None = Query(None, alias="from"),
    to_at: float | None = Query(None, alias="to"),
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    v = vehicle(db, ctx, vehicle_id)
    query = select(Trip).where(Trip.tenant_id == ctx.tenant_id, Trip.vehicle_id == v.id)
    fq = select(FuelEntry).where(FuelEntry.tenant_id == ctx.tenant_id, FuelEntry.vehicle_id == v.id)
    if from_at is not None:
        query, fq = (
            query.where(Trip.start_at >= from_at),
            fq.where(FuelEntry.observed_at >= from_at),
        )
    if to_at is not None:
        query, fq = query.where(Trip.start_at < to_at), fq.where(FuelEntry.observed_at < to_at)
    entries = list(db.scalars(fq.order_by(FuelEntry.observed_at).limit(1000)))
    tank_intervals = []
    last_full, purchased = None, 0.0
    for e in entries:
        purchased += e.litres
        if e.full_tank:
            if last_full and e.odometer_km > last_full.odometer_km:
                tank_intervals.append(
                    {
                        "from": last_full.observed_at,
                        "to": e.observed_at,
                        "litresPer100Km": purchased * 100 / (e.odometer_km - last_full.odometer_km),
                        "method": "MANUAL_TANK_TO_TANK",
                    }
                )
            last_full, purchased = e, 0
    return {
        **aggregate(list(db.scalars(query.limit(5000)))),
        "purchasedLitres": sum(e.litres for e in entries),
        "tankIntervals": tank_intervals,
        "origin": v.origin,
        "from": from_at,
        "to": to_at,
        "periodMethod": "SESSIONS_STARTED_IN_PERIOD",
        "costMethod": "NOT_ESTIMATED",
    }


@app.get("/api/v1/vehicles/{vehicle_id}/diagnostics")
def diagnostics(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    vehicle(db, ctx, vehicle_id)
    return [
        {"code": s.value, "observedAt": s.observed_at, "origin": s.origin}
        for s in db.scalars(
            select(Sample)
            .where(
                Sample.tenant_id == ctx.tenant_id,
                Sample.vehicle_id == vehicle_id,
                Sample.signal == "DTC",
            )
            .order_by(Sample.observed_at.desc())
            .limit(100)
        )
    ]


@app.get("/api/v1/vehicles/{vehicle_id}/findings")
def findings(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    vehicle(db, ctx, vehicle_id)
    return [
        serialize(f)
        for f in db.scalars(
            select(Finding)
            .where(Finding.tenant_id == ctx.tenant_id, Finding.vehicle_id == vehicle_id)
            .limit(100)
        )
    ]


@app.get("/api/v1/findings/{finding_id}/evidence")
def evidence(finding_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    return serialize(scoped(db, Finding, ctx, finding_id))


@app.get("/api/v1/vehicles/{vehicle_id}/maintenance-records")
def maintenance(vehicle_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    vehicle(db, ctx, vehicle_id)
    return [
        serialize(m)
        for m in db.scalars(
            select(Maintenance)
            .where(Maintenance.tenant_id == ctx.tenant_id, Maintenance.vehicle_id == vehicle_id)
            .order_by(Maintenance.observed_at.desc())
            .limit(200)
        )
    ]


@app.post("/api/v1/vehicles/{vehicle_id}/maintenance-records", status_code=201)
def add_maintenance(
    vehicle_id: str,
    data: MaintenanceInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    vehicle(db, ctx, vehicle_id, write=True)
    m = Maintenance(tenant_id=ctx.tenant_id, vehicle_id=vehicle_id, **data.model_dump())
    db.add(m)
    if data.reset_baseline:
        for baseline in db.scalars(
            select(Baseline).where(
                Baseline.tenant_id == ctx.tenant_id, Baseline.vehicle_id == vehicle_id
            )
        ):
            baseline.data, baseline.status, baseline.reset_at = {}, "LEARNING", data.observed_at
            baseline.version += 1
    db.flush()
    audit(db, ctx, "MAINTENANCE_RECORDED", m.id)
    return serialize(m)


@app.get("/api/v1/organisations/{organisation_id}/fleet")
def fleet(organisation_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    if organisation_id != ctx.tenant_id:
        fail("TENANT_ACCESS_DENIED", 403)
    return overview(db, ctx)


@app.get("/api/v1/organisations/{organisation_id}/work-orders")
def work_orders(
    organisation_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
):
    if organisation_id != ctx.tenant_id:
        fail("TENANT_ACCESS_DENIED", 403)
    allowed = list(db.scalars(vehicle_scope(select(Vehicle.id), ctx)))
    return [
        serialize(w)
        for w in db.scalars(
            select(WorkOrder)
            .where(WorkOrder.tenant_id == ctx.tenant_id, WorkOrder.vehicle_id.in_(allowed))
            .limit(200)
        )
    ]


@app.post("/api/v1/organisations/{organisation_id}/work-orders", status_code=201)
def add_work_order(
    organisation_id: str,
    data: WorkOrderInput,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    if organisation_id != ctx.tenant_id:
        fail("TENANT_ACCESS_DENIED", 403)
    v = vehicle(db, ctx, data.vehicle_id, write=True)
    for finding_id in data.finding_ids:
        if scoped(db, Finding, ctx, finding_id).vehicle_id != v.id:
            fail("FINDING_VEHICLE_MISMATCH", 422)
    w = WorkOrder(tenant_id=ctx.tenant_id, origin=v.origin, **data.model_dump())
    db.add(w)
    db.flush()
    audit(db, ctx, "WORK_ORDER_CREATED", w.id)
    return serialize(w)


@app.patch("/api/v1/work-orders/{work_order_id}")
def patch_work_order(
    work_order_id: str,
    data: WorkOrderPatch,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    require_role(ctx, {"OWNER", "FLEET_OWNER", "FLEET_MANAGER", "TECHNICIAN"})
    w = scoped(db, WorkOrder, ctx, work_order_id)
    if w.version != data.version:
        fail("STALE_VERSION", 409)
    if w.status in {"COMPLETED", "CANCELLED"} and data.status != w.status:
        fail("TERMINAL_WORK_ORDER", 409)
    w.status, w.version = data.status, w.version + 1
    audit(db, ctx, "WORK_ORDER_UPDATED", w.id)
    return serialize(w)


@app.post("/api/v1/quotes", status_code=201)
def add_quote(data: QuoteInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    vehicle(db, ctx, data.vehicle_id, write=True)
    q = Quote(tenant_id=ctx.tenant_id, **data.model_dump())
    db.add(q)
    db.flush()
    return serialize(q)


@app.post("/api/v1/quotes/{quote_id}/reviews")
def quote_review(quote_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    return review_quote(db, ctx, quote_id)


@app.post("/api/v1/assistant/messages")
def assistant_message(
    data: AdvisorInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
):
    result = answer(db, ctx, data.vehicle_id, data.message)
    audit(
        db,
        ctx,
        "ADVISOR_READ",
        data.vehicle_id,
        {"type": result["type"], "evidenceIds": result["evidenceIds"]},
    )
    return result


@app.post("/api/v1/pending-actions/{action_id}/confirm")
def confirm_action(action_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    require_role(ctx)
    action = db.scalar(
        select(PendingAction)
        .where(PendingAction.id == action_id, PendingAction.tenant_id == ctx.tenant_id)
        .with_for_update()
    )
    if not action or action.actor != ctx.subject:
        fail("ACTION_NOT_FOUND", 404)
    if action.status == "CONFIRMED":
        return {"workOrderId": action.result_id, "duplicate": True}
    if action.expires_at < time.time() or action.status != "PENDING":
        fail("STALE_ACTION", 409)
    v = vehicle(db, ctx, action.payload["vehicleId"], write=True)
    if v.version != action.payload["vehicleVersion"] or v.archived:
        fail("STALE_ACTION", 409)
    order = WorkOrder(
        tenant_id=ctx.tenant_id,
        vehicle_id=v.id,
        origin=v.origin,
        title=action.payload["title"],
        finding_ids=action.payload["findingIds"],
    )
    db.add(order)
    db.flush()
    action.status, action.result_id = "CONFIRMED", order.id
    audit(db, ctx, "ACTION_CONFIRMED", action.id)
    return {"workOrderId": order.id, "duplicate": False}


@app.post("/api/v1/pending-actions/{action_id}/cancel")
def cancel_action(action_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    action = scoped(db, PendingAction, ctx, action_id)
    if action.actor != ctx.subject or action.status != "PENDING":
        fail("STALE_ACTION", 409)
    action.status = "CANCELLED"
    return {"cancelled": True}


@app.post("/api/v1/exports", status_code=202)
def export(data: ExportInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    for vehicle_id in data.vehicle_ids:
        vehicle(db, ctx, vehicle_id)
    job = Job(
        tenant_id=ctx.tenant_id,
        kind="EXPORT",
        key="export:" + uid(),
        payload={**data.model_dump(by_alias=True), "actor": ctx.subject},
    )
    db.add(job)
    db.flush()
    audit(db, ctx, "EXPORT_REQUESTED", job.id)
    return {"jobId": job.id}


@app.get("/api/v1/jobs/{job_id}")
def get_job(job_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    job = scoped(db, Job, ctx, job_id)
    if job.payload.get("actor") and job.payload["actor"] != ctx.subject:
        fail("RESOURCE_NOT_FOUND", 404)
    if job.payload.get("vehicleId"):
        vehicle(db, ctx, job.payload["vehicleId"])
    for vehicle_id in job.payload.get("vehicleIds", []):
        vehicle(db, ctx, vehicle_id)
    result = serialize(job)
    if result.get("result") and "csv" in result["result"]:
        result["result"] = {k: v for k, v in result["result"].items() if k != "csv"}
    return result


@app.get("/api/v1/exports/{job_id}/download")
def download(job_id: str, ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    get_job(job_id, ctx, db)
    job = scoped(db, Job, ctx, job_id)
    if job.kind != "EXPORT" or job.status != "COMPLETED":
        fail("EXPORT_NOT_READY", 409)
    return Response(
        job.result["csv"],
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="yazzy-vehicle-report.csv"'},
    )


@app.get("/api/v1/organisations/{organisation_id}/events")
def events(
    organisation_id: str,
    after: float = 0,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    require_role(ctx)
    if organisation_id != ctx.tenant_id:
        fail("TENANT_ACCESS_DENIED", 403)
    rows = list(
        db.scalars(
            select(Audit)
            .where(Audit.tenant_id == ctx.tenant_id, Audit.created_at > after)
            .order_by(Audit.created_at)
            .limit(100)
        )
    )
    # Finite durable SSE page. Client reconnects with the returned cursor; no process-local fanout.
    content = "".join(
        f"id: {r.created_at}\nevent: audit\ndata: {json.dumps(serialize(r))}\n\n" for r in rows
    )
    return Response(content or ": keepalive\n\n", media_type="text/event-stream")


@app.get("/api/v1/audit")
def audit_list(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    require_role(ctx)
    return [
        serialize(a)
        for a in db.scalars(
            select(Audit)
            .where(Audit.tenant_id == ctx.tenant_id)
            .order_by(Audit.created_at.desc())
            .limit(100)
        )
    ]


@app.get("/api/v1/privacy")
def privacy(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    p = db.scalar(
        select(Preference).where(
            Preference.tenant_id == ctx.tenant_id, Preference.actor == ctx.subject
        )
    )
    return (
        serialize(p) if p else {"research": False, "audio": False, "rawDays": 30, "routeDays": 90}
    )


@app.post("/api/v1/privacy")
def update_privacy(
    data: PrivacyInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
):
    p = db.scalar(
        select(Preference).where(
            Preference.tenant_id == ctx.tenant_id, Preference.actor == ctx.subject
        )
    )
    if p is None:
        p = Preference(tenant_id=ctx.tenant_id, actor=ctx.subject)
        db.add(p)
    for key, value in data.model_dump().items():
        setattr(p, key, value)
    audit(db, ctx, "PRIVACY_UPDATED", ctx.subject)
    db.flush()
    return serialize(p)


@app.get("/api/v1/operations")
def operations(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    require_role(ctx)
    counts = dict(
        db.execute(
            select(Job.status, func.count())
            .where(Job.tenant_id == ctx.tenant_id)
            .group_by(Job.status)
        ).all()
    )
    return {
        "jobs": counts,
        "hardware": "PENDING_DEVICE_TEST",
        "model": "INTERPRETABLE_TREND_ONLY",
        "advisor": "DETERMINISTIC_EVIDENCE_ADVISOR",
    }


@app.post("/api/v1/vehicles/{vehicle_id}/erase")
def erase(
    vehicle_id: str,
    confirm_name: str,
    ctx=Depends(authenticate),
    db=Depends(get_db, scope="function"),
):
    from yazzy.retention import erase_vehicle

    v = vehicle(db, ctx, vehicle_id, write=True)
    if not v.archived or confirm_name != v.name:
        fail("ARCHIVE_AND_CONFIRM_NAME_REQUIRED", 409)
    erase_vehicle(db, ctx, vehicle_id)
    return {
        "erased": True,
        "backupPolicy": "Deletion tombstone must be reapplied after restoration",
    }


# Simulation routes are registered last to keep scenario code out of production domain imports.
from yazzy.modules.fleet.simulation import install_routes  # noqa: E402

install_routes(app)

from yazzy.api.car_pictures import router as car_pictures_router  # noqa: E402
from yazzy.api.releases import router as releases_router  # noqa: E402

app.include_router(releases_router)
app.include_router(car_pictures_router)
