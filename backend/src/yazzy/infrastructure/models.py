"""SQL source of truth. All vehicle-owned rows retain tenant and origin.

Identity tables deliberately precede tenant context; business tables have RLS in PostgreSQL.
"""

import time
import uuid
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str]
    is_demo: Mapped[bool] = mapped_column(default=False)


class Account(Base):
    """A person who signs in with e-mail and password; their memberships use the subject "account:<id>"."""

    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(default="")
    password_hash: Mapped[str]
    created_at: Mapped[float] = mapped_column(default=time.time)


class Membership(Base):
    __tablename__ = "memberships"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    subject: Mapped[str] = mapped_column(index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"))
    role: Mapped[str]
    active: Mapped[bool] = mapped_column(default=True)
    vehicle_ids: Mapped[list] = mapped_column(JSON, default=list)
    __table_args__ = (UniqueConstraint("subject", "tenant_id"),)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(primary_key=True)
    membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id"))
    csrf: Mapped[str]
    expires_at: Mapped[float]


class CarPicture(Base):
    """A carimage.dev render of one catalog vehicle (yazzy.modules.garage.car_picture). Shared, not tenant data."""

    __tablename__ = "car_pictures"
    id: Mapped[str] = mapped_column(primary_key=True)  # the catalog vehicle id, veh_...
    make: Mapped[str]
    model: Mapped[str]
    year: Mapped[int]
    status: Mapped[str]  # PENDING, READY, NONE (not in the catalog), FAILED (try again later)
    image: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_at: Mapped[float]


class Scoped:
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(String, index=True)


class Vehicle(Scoped, Base):
    __tablename__ = "vehicles"
    name: Mapped[str]
    make: Mapped[str] = mapped_column(default="")
    model: Mapped[str] = mapped_column(default="")
    year: Mapped[int | None]
    category: Mapped[str] = mapped_column(default="PERSONAL")  # PERSONAL or BUSINESS
    # Plate, inspection and insurance dates, and the last vignette and fine checks (never the owner's EGN).
    documents: Mapped[dict | None] = mapped_column(JSON)
    fuel_type: Mapped[str] = mapped_column(default="PETROL")
    powertrain: Mapped[str] = mapped_column(default="ICE")
    origin: Mapped[str] = mapped_column(default="REAL")
    archived: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(default=1)
    odometer_km: Mapped[float | None]
    service_due_at: Mapped[float | None]
    service_due_km: Mapped[float | None]
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    # What the phone last read from the car over OBD: VIN, fuel type, fault codes, readiness, latest readings.
    profile: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=time.time)
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class SimulationRun(Scoped, Base):
    __tablename__ = "simulation_runs"
    scenario: Mapped[str]
    scenario_version: Mapped[str] = mapped_column(default="1")
    seed: Mapped[int]
    status: Mapped[str] = mapped_column(default="PAUSED")
    virtual_now: Mapped[float]
    start_at: Mapped[float]
    speed: Mapped[int] = mapped_column(default=30)
    tick: Mapped[int] = mapped_column(default=0)
    generation: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[float] = mapped_column(default=time.time)
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class Device(Scoped, Base):
    __tablename__ = "devices"
    name: Mapped[str]
    token_hash: Mapped[str] = mapped_column(unique=True)
    origin: Mapped[str]
    source: Mapped[str]
    revoked: Mapped[bool] = mapped_column(default=False)
    run_id: Mapped[str | None]
    last_received_at: Mapped[float | None]
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class Assignment(Scoped, Base):
    __tablename__ = "assignments"
    device_id: Mapped[str]
    vehicle_id: Mapped[str]
    valid_from: Mapped[float]
    valid_until: Mapped[float | None]
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(["tenant_id", "vehicle_id"], ["vehicles.tenant_id", "vehicles.id"]),
        ForeignKeyConstraint(["tenant_id", "device_id"], ["devices.tenant_id", "devices.id"]),
    )


class Batch(Scoped, Base):
    __tablename__ = "batches"
    device_id: Mapped[str]
    batch_key: Mapped[str]
    payload_hash: Mapped[str]
    received_at: Mapped[float] = mapped_column(default=time.time)
    job_id: Mapped[str]
    __table_args__ = (UniqueConstraint("device_id", "batch_key"),)


class Sample(Scoped, Base):
    __tablename__ = "samples"
    device_id: Mapped[str]
    assignment_id: Mapped[str]
    vehicle_id: Mapped[str]
    session_id: Mapped[str]
    sequence: Mapped[int]
    observed_at: Mapped[float]
    received_at: Mapped[float] = mapped_column(default=time.time)
    monotonic_ms: Mapped[int | None]
    signal: Mapped[str]
    value: Mapped[Any] = mapped_column(JSON)
    quality: Mapped[str]
    unit: Mapped[str]
    origin: Mapped[str]
    run_id: Mapped[str | None]
    decoder_version: Mapped[str]
    payload_hash: Mapped[str]
    __table_args__ = (
        UniqueConstraint("device_id", "session_id", "sequence"),
        ForeignKeyConstraint(["tenant_id", "vehicle_id"], ["vehicles.tenant_id", "vehicles.id"]),
        Index("sample_vehicle_time", "tenant_id", "vehicle_id", "observed_at"),
    )


class Job(Scoped, Base):
    __tablename__ = "jobs"
    kind: Mapped[str]
    key: Mapped[str] = mapped_column(unique=True)
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    generation: Mapped[int] = mapped_column(default=0)
    lease_until: Mapped[float] = mapped_column(default=0)
    published_at: Mapped[float] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=time.time)
    error: Mapped[str | None]
    result: Mapped[dict | None] = mapped_column(JSON)


class Trip(Scoped, Base):
    __tablename__ = "trips"
    vehicle_id: Mapped[str]
    device_id: Mapped[str]
    session_id: Mapped[str]
    run_id: Mapped[str | None]
    origin: Mapped[str]
    start_at: Mapped[float]
    end_at: Mapped[float | None]
    detected_at: Mapped[float]
    status: Mapped[str]
    metrics: Mapped[dict] = mapped_column(JSON)
    calculation_version: Mapped[str] = mapped_column(default="trip-fuel-v1")
    __table_args__ = (Index("trip_vehicle_time", "tenant_id", "vehicle_id", "start_at"),)


class Revision(Scoped, Base):
    __tablename__ = "trip_revisions"
    vehicle_id: Mapped[str]
    actor: Mapped[str]
    kind: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=time.time)


class FuelEntry(Scoped, Base):
    __tablename__ = "fuel_entries"
    vehicle_id: Mapped[str]
    litres: Mapped[float]
    total_paid: Mapped[float]
    currency: Mapped[str]
    odometer_km: Mapped[float]
    full_tank: Mapped[bool]
    observed_at: Mapped[float]
    idempotency_key: Mapped[str]
    __table_args__ = (UniqueConstraint("tenant_id", "idempotency_key"),)


class Finding(Scoped, Base):
    __tablename__ = "findings"
    vehicle_id: Mapped[str]
    run_id: Mapped[str | None]
    origin: Mapped[str]
    type: Mapped[str]
    status: Mapped[str]
    severity: Mapped[str]
    summary: Mapped[str]
    evidence: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=time.time)
    resolved_at: Mapped[float | None]
    __table_args__ = (
        CheckConstraint(
            "severity IN ('ADVISORY', 'INFORMATION', 'URGENT')", name="finding_severity"
        ),
    )


class Baseline(Scoped, Base):
    __tablename__ = "baselines"
    vehicle_id: Mapped[str]
    origin: Mapped[str]
    run_id: Mapped[str | None]
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str]
    data: Mapped[dict] = mapped_column(JSON)
    reset_at: Mapped[float] = mapped_column(default=0)


class Maintenance(Scoped, Base):
    __tablename__ = "maintenance_records"
    vehicle_id: Mapped[str]
    description: Mapped[str]
    observed_at: Mapped[float]
    odometer_km: Mapped[float | None]
    actual_cost: Mapped[float | None]
    currency: Mapped[str]
    outcome: Mapped[dict] = mapped_column(JSON, default=dict)
    reset_baseline: Mapped[bool] = mapped_column(default=False)
    # Free-text details, and the odometer reading at which this service should be done again.
    notes: Mapped[str | None]
    next_due_km: Mapped[float | None]


class WorkOrder(Scoped, Base):
    __tablename__ = "work_orders"
    vehicle_id: Mapped[str]
    title: Mapped[str]
    status: Mapped[str] = mapped_column(default="OPEN")
    priority: Mapped[str] = mapped_column(default="NORMAL")
    due_at: Mapped[float | None]
    assigned_to: Mapped[str | None]
    finding_ids: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(default=1)
    origin: Mapped[str]
    created_at: Mapped[float] = mapped_column(default=time.time)


class Quote(Scoped, Base):
    __tablename__ = "quotes"
    vehicle_id: Mapped[str]
    currency: Mapped[str]
    lines: Mapped[list] = mapped_column(JSON)
    verified: Mapped[bool]
    review: Mapped[dict | None] = mapped_column(JSON)


class PendingAction(Scoped, Base):
    __tablename__ = "pending_actions"
    actor: Mapped[str]
    kind: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[float]
    status: Mapped[str] = mapped_column(default="PENDING")
    result_id: Mapped[str | None]


class Audit(Scoped, Base):
    __tablename__ = "audit_events"
    actor: Mapped[str]
    action: Mapped[str]
    resource_id: Mapped[str]
    created_at: Mapped[float] = mapped_column(default=time.time)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class Preference(Scoped, Base):
    __tablename__ = "data_permissions"
    actor: Mapped[str]
    research: Mapped[bool] = mapped_column(default=False)
    audio: Mapped[bool] = mapped_column(default=False)
    raw_days: Mapped[int] = mapped_column(default=30)
    route_days: Mapped[int] = mapped_column(default=90)
    __table_args__ = (UniqueConstraint("tenant_id", "actor"),)


# Database-level tenant integrity complements application authorisation and PostgreSQL RLS.
for _table in Base.metadata.tables.values():
    if "tenant_id" in _table.c and _table.name != "memberships":
        _table.append_constraint(
            ForeignKeyConstraint(
                ["tenant_id"], ["organisations.id"], name=f"fk_{_table.name}_tenant"
            )
        )
    if "vehicle_id" in _table.c and _table.name not in {"assignments", "samples"}:
        _table.append_constraint(
            ForeignKeyConstraint(
                ["tenant_id", "vehicle_id"],
                ["vehicles.tenant_id", "vehicles.id"],
                name=f"fk_{_table.name}_vehicle_tenant",
            )
        )
Index(
    "one_active_primary_device",
    Assignment.device_id,
    unique=True,
    sqlite_where=Assignment.valid_until.is_(None),
    postgresql_where=Assignment.valid_until.is_(None),
)
Index(
    "one_active_primary_vehicle",
    Assignment.vehicle_id,
    unique=True,
    sqlite_where=Assignment.valid_until.is_(None),
    postgresql_where=Assignment.valid_until.is_(None),
)
