"""Drop conversations & messages; documents are a flat library

Conversations and chat messages are owned by the Aegra agents service now, so
this service no longer stores them. Documents are no longer scoped to a
conversation — a conversation (Aegra thread) tracks its documents via its own
thread metadata instead.

Removes: ``documents.conversation_id`` (and its FK), the ``messages`` table, and
the ``conversations`` table.

Revision ID: 004_drop_conversations
Revises: 003_document_chunks
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_drop_conversations"
down_revision: str | None = "003_document_chunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # documents.conversation_id references conversations(id); drop it first so
    # the conversations table can be removed.
    op.drop_column("documents", "conversation_id")
    op.drop_table("messages")
    op.drop_table("conversations")


def downgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sources_cited", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
    )
    op.add_column(
        "documents",
        sa.Column("conversation_id", sa.String(), nullable=True),
    )
    op.create_foreign_key(
        "documents_conversation_id_fkey",
        "documents",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
