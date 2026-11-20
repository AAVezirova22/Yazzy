"""Drop the APK tables: APKs now live in the GitHub release `android` (see yazzy.api.releases).

Dropping the tables, rather than deleting their rows, gives the space back to the database at once.
"""

import sqlalchemy as sa
from alembic import op

revision = "e9f0a1b2"
down_revision = "d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table("app_release_parts")
    op.drop_table("app_releases")


def downgrade():
    # The tables come back empty; publish an APK again to fill them.
    op.create_table(
        "app_releases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("version_code", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("complete", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.Double(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "app_release_parts",
        sa.Column("release_id", sa.String(), nullable=False),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(["release_id"], ["app_releases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("release_id", "index"),
    )
