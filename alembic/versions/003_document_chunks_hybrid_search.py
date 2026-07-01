"""Document ingestion: chunks, embeddings, status, and hybrid-search indexes

Adds the ingestion pipeline schema:

* ``documents`` gains ``status`` / ``chunk_count`` / ``error`` so the frontend can
  poll how far along indexing is.
* ``document_chunks`` stores retrievable document units plus their embeddings.
* Two index access methods power hybrid retrieval, both provided by the
  ``timescale/timescaledb-ha`` image:
  - ``diskann`` (pgvectorscale) over the ``embedding`` column for dense search, and
  - ``bm25`` (pg_textsearch) over ``content`` for sparse/keyword search.

The query layer fuses these two rankings with reciprocal rank fusion.

Note: ``pg_textsearch`` must be listed in ``shared_preload_libraries`` for
``CREATE EXTENSION pg_textsearch`` to succeed — docker-compose passes
``-c shared_preload_libraries=timescaledb,pg_textsearch`` to the db service.

Revision ID: 003_document_chunks
Revises: 002_document_optional_scope
Create Date: 2026-06-30 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_document_chunks"
down_revision: str | None = "002_document_optional_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMBEDDING_DIM = 1536  # matches the configured Gemini embedding dimensionality


def upgrade() -> None:
    # Extensions (idempotent). vectorscale CASCADE pulls in pgvector.
    op.execute("CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_textsearch")

    # --- Document ingestion status -----------------------------------------
    op.add_column(
        "documents",
        sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "documents",
        sa.Column(
            "chunk_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column("documents", sa.Column("error", sa.Text(), nullable=True))

    # --- Chunks + embeddings -----------------------------------------------
    # Written with raw SQL because the embedding column uses the pgvector
    # `vector` type, which core SQLAlchemy types don't model.
    op.execute(
        f"""
        CREATE TABLE document_chunks (
            id VARCHAR PRIMARY KEY,
            document_id VARCHAR NOT NULL
                REFERENCES documents(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            page_no INTEGER,
            headings TEXT,
            token_count INTEGER,
            embedding vector({EMBEDDING_DIM}),
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.create_index("ix_document_chunks_document_id", "document_chunks", ["document_id"])

    # Sparse: pg_textsearch BM25 over the raw text column.
    op.execute(
        """
        CREATE INDEX document_chunks_bm25_idx ON document_chunks
        USING bm25 (content) WITH (text_config = 'english')
        """
    )

    # Dense: pgvectorscale StreamingDiskANN, cosine distance.
    op.execute(
        """
        CREATE INDEX document_chunks_embedding_idx ON document_chunks
        USING diskann (embedding vector_cosine_ops)
        """
    )


def downgrade() -> None:
    op.drop_table("document_chunks")
    op.drop_column("documents", "error")
    op.drop_column("documents", "chunk_count")
    op.drop_column("documents", "status")
    # Extensions are intentionally left installed.
