"""Service history: free-text notes, the odometer reading a service is due again at, and when a work order was made."""

import sqlalchemy as sa
from alembic import op

revision = "i4d5e6f7"
down_revision = "h3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("maintenance_records", sa.Column("notes", sa.String(), nullable=True))
    op.add_column("maintenance_records", sa.Column("next_due_km", sa.Float(), nullable=True))
    op.add_column(
        "work_orders",
        sa.Column("created_at", sa.Float(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("work_orders", "created_at")
    op.drop_column("maintenance_records", "next_due_km")
    op.drop_column("maintenance_records", "notes")
