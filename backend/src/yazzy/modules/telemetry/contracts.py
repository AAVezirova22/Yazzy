import math
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

Identifier = Annotated[
    str, StringConstraints(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")
]


class Contract(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", allow_inf_nan=False
    )


# Canonical units and physical plausibility, not diagnostic thresholds.
SIGNALS = {
    "ENGINE_RPM": ("rpm", 0, 16000),
    "VEHICLE_SPEED": ("km/h", 0, 350),
    "COOLANT_TEMP": ("degC", -40, 215),
    "AMBIENT_TEMP": ("degC", -60, 80),
    "INTAKE_TEMP": ("degC", -40, 215),
    "INTAKE_PRESSURE": ("kPa", 0, 255),
    "MAF": ("g/s", 0, 655),
    "ENGINE_LOAD": ("%", 0, 100),
    "THROTTLE": ("%", 0, 100),
    "SHORT_FUEL_TRIM": ("%", -100, 100),
    "LONG_FUEL_TRIM": ("%", -100, 100),
    "FUEL_RATE": ("L/h", 0, 200),
    "FUEL_COUNTER": ("L", 0, 1e9),
    "ODOMETER": ("km", 0, 1e8),
    "MODULE_VOLTAGE": ("V", 0, 60),
    "ADAPTER_VOLTAGE": ("V", 0, 60),
    "FUEL_LEVEL": ("%", 0, 100),
    "IGNITION": ("bool", 0, 1),
    "USER_STOP": ("bool", 0, 1),
    "GAP": ("s", 0, 86400),
    "GPS": ("deg", None, None),
    "DTC": ("code", None, None),
}


class Position(Contract):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, le=10000)
    fix_age: float = Field(default=0, ge=0, le=86400)
    valid_fix: bool = True
    provider: Literal["PHONE", "SIMULATOR", "REPLAY"]


class SignalSample(Contract):
    sequence: int = Field(ge=0, le=2**53 - 1)
    observed_at: datetime
    monotonic_ms: int | None = Field(default=None, ge=0)
    signal: str
    value: float | Position | str | None
    unit: str
    quality: Literal["VALID", "UNAVAILABLE", "UNSUPPORTED", "INVALID", "ESTIMATED"] = "VALID"

    @field_validator("observed_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError("observedAt must include a timezone")
        return value

    @model_validator(mode="after")
    def valid_signal(self):
        if self.signal not in SIGNALS:
            raise ValueError("Unknown signal")
        unit, lower, upper = SIGNALS[self.signal]
        if self.unit != unit:
            raise ValueError("Invalid canonical unit")
        if self.value is None:
            if self.quality in {"VALID", "ESTIMATED"}:
                raise ValueError("Missing value cannot have valid quality")
        elif self.signal == "GPS":
            if not isinstance(self.value, Position):
                raise ValueError("GPS requires a position")
        elif self.signal == "DTC":
            import re

            if not isinstance(self.value, str) or not re.fullmatch(
                r"[PCBU][0-3][0-9A-F]{3}", self.value
            ):
                raise ValueError("Invalid diagnostic code")
        elif (
            not isinstance(self.value, (int, float))
            or not math.isfinite(self.value)
            or lower is None
            or upper is None
            or not lower <= self.value <= upper
        ):
            raise ValueError("Signal value out of range")
        return self


class TelemetryBatch(Contract):
    schema_version: Literal[1] = 1
    batch_id: Identifier
    device_id: Identifier
    assignment_id: Identifier
    session_id: Identifier
    sequence_start: int = Field(ge=0)
    source: Literal["MOBILE_OBD", "SIMULATED_FLEET"]
    platform: Literal["IOS", "ANDROID", "SIMULATOR"]
    decoder_version: str = Field(default="elm-v1", max_length=40)
    simulation_run_id: Identifier | None = None
    scenario_version: str | None = None
    scenario_seed: int | None = None
    samples: list[SignalSample] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def sequence_unique(self):
        sequences = [s.sequence for s in self.samples]
        if len(set(sequences)) != len(sequences) or min(sequences) != self.sequence_start:
            raise ValueError("Sequences must be unique and match sequenceStart")
        return self
