"""A car's documents: plate, inspection and insurance dates, last vignette and fine checks."""

import sqlalchemy as sa
from alembic import op

revision = "h3c4d5e6"
down_revision = "g2b3c4d5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vehicles", sa.Column("documents", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("vehicles", "documents")
