"""app_releases: the latest Android APK for in-app updates."""

import sqlalchemy as sa
from alembic import op

revision = "b4c1d2e3"
down_revision = "7a2e0c19"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_releases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("version_code", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.Double(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("app_releases")
