"""Tenant RLS for business data; authentication registries stay outside RLS.

Migration role owns tables; API/worker use a separate NOBYPASSRLS runtime role.
"""

from alembic import op

revision = "7a2e0c19"
down_revision = "026618e22aee"
branch_labels = None
depends_on = None
TABLES = [
    "vehicles",
    "simulation_runs",
    "assignments",
    "batches",
    "samples",
    "jobs",
    "trips",
    "trip_revisions",
    "fuel_entries",
    "findings",
    "baselines",
    "maintenance_records",
    "work_orders",
    "quotes",
    "pending_actions",
    "audit_events",
    "data_permissions",
]


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'''CREATE POLICY tenant_scope ON "{table}"
            USING (tenant_id = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true))''')


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'DROP POLICY tenant_scope ON "{table}"')
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
