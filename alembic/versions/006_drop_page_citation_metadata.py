"""No-op page citation metadata cleanup

Revision ID: 006_drop_page_citation_metadata
Revises: 004_drop_conversations
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "006_drop_page_citation_metadata"
down_revision: str | None = "004_drop_conversations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
