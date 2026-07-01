"""Drop obsolete page citation metadata columns

Revision ID: 006_drop_page_citation_metadata
Revises: 005_page_citation_metadata
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006_drop_page_citation_metadata"
down_revision: str | None = "005_page_citation_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS citation_blocks")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS page_height")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS page_width")


def downgrade() -> None:
    op.add_column("document_chunks", sa.Column("page_width", sa.Float(), nullable=True))
    op.add_column("document_chunks", sa.Column("page_height", sa.Float(), nullable=True))
    op.add_column("document_chunks", sa.Column("citation_blocks", sa.JSON(), nullable=True))
