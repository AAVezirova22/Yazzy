"""Administrative identity bootstrap. Run with migration-role credentials, never an API request."""

import argparse

from sqlalchemy import select
from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import Membership, Organisation

p = argparse.ArgumentParser()
p.add_argument("--tenant", required=True)
p.add_argument("--name", required=True)
p.add_argument(
    "--subject", required=True, help="Exact sub claim from the trusted OIDC provider"
)
p.add_argument(
    "--role", choices=["OWNER", "FLEET_OWNER", "FLEET_MANAGER"], default="OWNER"
)
a = p.parse_args()
with transaction(a.tenant) as db:
    org = db.get(Organisation, a.tenant)
    if org is None:
        db.add(Organisation(id=a.tenant, name=a.name, is_demo=False))
        db.flush()
    if db.scalar(
        select(Membership).where(
            Membership.subject == a.subject, Membership.tenant_id == a.tenant
        )
    ):
        raise SystemExit(
            "Membership already exists; review administrative changes explicitly"
        )
    db.add(
        Membership(
            subject=a.subject,
            tenant_id=a.tenant,
            role=a.role,
            active=True,
            vehicle_ids=[],
        )
    )
print("Membership provisioned. No telemetry or simulated vehicles were created.")
