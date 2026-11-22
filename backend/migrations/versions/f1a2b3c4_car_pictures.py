"""carimage.dev car pictures, one per catalog vehicle; shared by every tenant, so no row-level security."""

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4"
down_revision = "e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "car_pictures",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("make", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=True),
        sa.Column("updated_at", sa.Double(), nullable=False),
    )


def downgrade():
    op.drop_table("car_pictures")
