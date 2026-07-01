"""Documents may or may not be scoped to a chat

Make documents.conversation_id nullable so a document can be unscoped
("library") rather than always belonging to a single conversation.

Revision ID: 002_document_optional_scope
Revises: 001_initial
Create Date: 2026-06-30 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_document_optional_scope"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "documents",
        "conversation_id",
        existing_type=sa.String(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "documents",
        "conversation_id",
        existing_type=sa.String(),
        nullable=False,
    )
