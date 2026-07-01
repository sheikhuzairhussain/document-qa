from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from backend.config import settings


class Base(DeclarativeBase):
    pass


# Ingestion lifecycle for a document, surfaced to the frontend so it can show
# whether a document is ready to be queried.
DOCUMENT_STATUS_PENDING = "pending"
DOCUMENT_STATUS_PROCESSING = "processing"
DOCUMENT_STATUS_COMPLETED = "completed"
DOCUMENT_STATUS_FAILED = "failed"


class Document(Base):
    """An uploaded document and its ingestion state.

    Documents are a flat library: they are not tied to a conversation here.
    Conversations (Aegra threads) track which documents belong to them via their
    own thread metadata; this service just stores and indexes the files.
    """

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:16])
    filename: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Ingestion pipeline status (pending -> processing -> completed/failed).
    status: Mapped[str] = mapped_column(String, default=DOCUMENT_STATUS_PENDING)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    chunks: Mapped[list[DocumentChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentChunk(Base):
    """A retrievable page of a document.

    Produced by the ingestion worker (PyMuPDF page extraction + Gemini page-PDF
    embeddings) and queried via hybrid search that fuses two rankings with
    reciprocal rank fusion:

    * dense  — pgvectorscale StreamingDiskANN over ``embedding`` (cosine), and
    * sparse — pg_textsearch BM25 over ``content`` (a ``bm25`` index built on the
      text column directly; no separate tsvector column is needed).

    Both indexes are created in migration ``003`` rather than by SQLAlchemy, since
    they use access methods (``diskann``, ``bm25``) the ORM doesn't model.
    """

    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    # 1-based page number where the chunk starts (None if unknown).
    page_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Reserved for future section labels; page-level ingestion does not set this.
    headings: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dim), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped[Document] = relationship(back_populates="chunks")
