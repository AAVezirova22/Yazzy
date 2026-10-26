import argparse

from sqlalchemy import select

from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import Membership, Organisation, Vehicle


def seed():
    with transaction() as db:
        for identifier, name, demo, subject, role in [
            ("demo-mobility", "Yazzy Demo Mobility", True, "local-fleet", "FLEET_OWNER"),
            ("personal-sandbox", "My garage", False, "local-personal", "OWNER"),
        ]:
            if db.get(Organisation, identifier) is None:
                db.add(Organisation(id=identifier, name=name, is_demo=demo))
                db.flush()
                db.add(Membership(tenant_id=identifier, subject=subject, role=role))
    with transaction("personal-sandbox") as db:
        if not db.scalar(select(Vehicle).where(Vehicle.tenant_id == "personal-sandbox")):
            db.add(
                Vehicle(
                    tenant_id="personal-sandbox",
                    name="My first car",
                    origin="REAL",
                    capabilities={
                        "verificationStatus": "PENDING_DEVICE_TEST",
                        "supportedSignals": [],
                        "backgroundRecording": "NOT_VERIFIED",
                        "crankingVoltage": "NOT_VERIFIED",
                    },
                )
            )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--demo", action="store_true")
    args = p.parse_args()
    if args.demo:
        from yazzy.config import settings

        if settings.environment == "production":
            raise SystemExit("Demo bootstrap is forbidden in production")
        seed()


if __name__ == "__main__":
    main()
