"""Store APK releases in parts so the API never holds a whole APK in memory."""

import sqlalchemy as sa
from alembic import op

revision = "c5d6e7f8"
down_revision = "b4c1d2e3"
branch_labels = None
depends_on = None


def releases_table(*extra):
    op.create_table(
        "app_releases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("version_code", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        *extra,
        sa.Column("created_at", sa.Double(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def upgrade():
    # The single-blob table held at most one release; recreate it without the blob.
    op.drop_table("app_releases")
    releases_table(sa.Column("complete", sa.Boolean(), nullable=False))
    op.create_table(
        "app_release_parts",
        sa.Column("release_id", sa.String(), nullable=False),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(["release_id"], ["app_releases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("release_id", "index"),
    )


def downgrade():
    op.drop_table("app_release_parts")
    op.drop_table("app_releases")
    releases_table(sa.Column("data", sa.LargeBinary(), nullable=False))
