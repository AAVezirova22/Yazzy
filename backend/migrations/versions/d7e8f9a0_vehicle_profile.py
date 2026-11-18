"""Keep what the phone last read from each car over OBD (VIN, fuel type, codes, readiness)."""

import sqlalchemy as sa
from alembic import op

revision = "d7e8f9a0"
down_revision = "c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vehicles", sa.Column("profile", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("vehicles", "profile")
