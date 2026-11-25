import json
from typing import Literal

from pydantic import Field, field_validator

from yazzy.modules.telemetry.contracts import Contract, Identifier


class VehicleInput(Contract):
    name: str = Field(min_length=1, max_length=100)
    make: str = Field(default="", max_length=60)
    model: str = Field(default="", max_length=60)
    year: int | None = Field(default=None, ge=1950, le=2100)
    fuel_type: Literal["PETROL", "DIESEL", "ELECTRIC", "LPG"] = "PETROL"
    powertrain: Literal["ICE", "HYBRID", "EV"] = "ICE"
    odometer_km: float | None = Field(default=None, ge=0)
    category: Literal["PERSONAL", "BUSINESS"] = "PERSONAL"


class VehiclePatch(Contract):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    make: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=60)
    year: int | None = Field(default=None, ge=1950, le=2100)
    fuel_type: Literal["PETROL", "DIESEL", "ELECTRIC", "LPG"] | None = None
    powertrain: Literal["ICE", "HYBRID", "EV"] | None = None
    odometer_km: float | None = Field(default=None, ge=0, le=1e8)
    archived: bool | None = None
    category: Literal["PERSONAL", "BUSINESS"] | None = None
    service_due_at: float | None = None
    service_due_km: float | None = Field(default=None, ge=0)
    profile: dict | None = None
    documents: dict | None = None

    @field_validator("profile")
    @classmethod
    def small_profile(cls, value):
        # The car report is a few kilobytes; anything far larger is not one.
        if value is not None and len(json.dumps(value)) > 65536:
            raise ValueError("Vehicle profile too large")
        return value

    @field_validator("documents")
    @classmethod
    def plain_documents(cls, value):
        # Plate, VIN, ГТП and insurance dates and the last vignette/toll check: small, and never the owner's
        # identity numbers, which stay on the phone.
        if value is None:
            return value
        allowed = {"plate", "vin", "gtpUntil", "insuranceUntil", "vignette", "apiFines", "katFines", "checkedAt"}
        if set(value) - allowed or len(json.dumps(value)) > 8192:
            raise ValueError("Unexpected vehicle documents")
        return value


class RebuildInput(Contract):
    days: int = Field(default=14, ge=1, le=30)


class Enrollment(Contract):
    vehicle_id: Identifier
    name: str = Field(default="Vgate iCar Pro phone collector", min_length=1, max_length=100)


class AssignmentInput(Contract):
    vehicle_id: Identifier
    valid_from: float


class FuelInput(Contract):
    litres: float = Field(gt=0, le=500)
    total_paid: float = Field(ge=0, le=100000)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    odometer_km: float = Field(ge=0, le=1e8)
    full_tank: bool = False
    observed_at: float
    idempotency_key: Identifier


class MaintenanceInput(Contract):
    description: str = Field(min_length=1, max_length=2000)
    observed_at: float
    odometer_km: float | None = Field(default=None, ge=0, le=10_000_000)
    actual_cost: float | None = Field(default=None, ge=0, le=10_000_000)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    notes: str | None = Field(default=None, max_length=4000)
    next_due_km: float | None = Field(default=None, ge=0, le=10_000_000)
    outcome: dict = Field(default_factory=dict)
    reset_baseline: bool = False

    @field_validator("outcome")
    @classmethod
    def outcome_schema(cls, value):
        allowed = {
            "cause",
            "source",
            "breakdown",
            "inspectionAt",
            "diagnosisAt",
            "repairAt",
            "reviewStatus",
            "recurrence",
            "fitmentSource",
        }
        if value.keys() - allowed:
            raise ValueError("Unknown outcome fields")
        if value.get("source", "UNKNOWN") not in {
            "UNKNOWN",
            "USER_REPORTED",
            "TECHNICIAN_CONFIRMED",
        }:
            raise ValueError("AI suggestions are not ground truth labels")
        return value


class WorkOrderInput(Contract):
    vehicle_id: Identifier
    title: str = Field(min_length=1, max_length=300)
    priority: Literal["LOW", "NORMAL", "HIGH"] = "NORMAL"
    due_at: float | None = None
    assigned_to: str | None = Field(default=None, max_length=100)
    finding_ids: list[Identifier] = Field(default_factory=list, max_length=20)


class WorkOrderPatch(Contract):
    version: int = Field(ge=1)
    status: Literal[
        "OPEN",
        "ACKNOWLEDGED",
        "SCHEDULED",
        "IN_PROGRESS",
        "AWAITING_PARTS",
        "COMPLETED",
        "CANCELLED",
    ]


class QuoteLine(Contract):
    description: str = Field(min_length=1, max_length=500)
    category: Literal["DIAGNOSTIC", "PART", "LABOUR", "TAX", "OTHER"] = "OTHER"
    amount: float = Field(ge=0, le=100000)


class QuoteInput(Contract):
    vehicle_id: Identifier
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    lines: list[QuoteLine] = Field(min_length=1, max_length=50)
    verified: bool


class AdvisorInput(Contract):
    vehicle_id: Identifier
    message: str = Field(min_length=1, max_length=2000)


class CorrectionInput(Contract):
    type: Literal["SPLIT", "MERGE"]
    at: float | None = None
    other_trip_id: Identifier | None = None
    reason: str = Field(min_length=3, max_length=300)


class SimulationInput(Contract):
    scenario: Literal[
        "CITY",
        "STOP_START",
        "MISSING_SENSORS",
        "GPS_LOSS",
        "DRIFT_HISTORY",
        "RECOVERY",
        "OFFLINE",
        "DUPLICATES",
        "OUT_OF_ORDER",
    ] = "CITY"
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    vehicles: int = Field(default=12, ge=10, le=20)
    speed: int = Field(default=30, ge=1, le=3600)


class SimulationControl(Contract):
    action: Literal["START", "PAUSE", "RESUME", "RESET", "SPEED"]
    speed: int | None = Field(default=None, ge=1, le=3600)


class PrivacyInput(Contract):
    research: bool = False
    audio: bool = False
    raw_days: int = Field(default=30, ge=1, le=90)
    route_days: int = Field(default=90, ge=1, le=365)


class ExportInput(Contract):
    vehicle_ids: list[Identifier] = Field(min_length=1, max_length=20)
    from_at: float | None = None
    to_at: float | None = None
