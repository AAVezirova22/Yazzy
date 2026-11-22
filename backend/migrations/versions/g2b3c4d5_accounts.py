"""Accounts (e-mail and password sign-in) and the Personal / Business group of each vehicle."""

import sqlalchemy as sa
from alembic import op

revision = "g2b3c4d5"
down_revision = "f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.Double(), nullable=False),
    )
    op.add_column("vehicles", sa.Column("category", sa.String(), nullable=False, server_default="PERSONAL"))


def downgrade():
    op.drop_column("vehicles", "category")
    op.drop_table("accounts")
