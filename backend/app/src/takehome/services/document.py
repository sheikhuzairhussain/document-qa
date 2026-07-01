from __future__ import annotations

import os
import uuid
from pathlib import PurePath

import structlog
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.config import settings
from takehome.db.models import (
    DOCUMENT_STATUS_FAILED,
    DOCUMENT_STATUS_PENDING,
    Document,
)
from takehome.services.queue import enqueue_ingestion

logger = structlog.get_logger()

DEFAULT_DOCUMENT_FILENAME = "document.pdf"
MAX_STORED_FILENAME_LENGTH = 180


async def upload_document(session: AsyncSession, file: UploadFile) -> Document:
    """Upload a PDF document.

    Validates the file is a PDF, saves it to disk, stores metadata, and enqueues
    background ingestion. Documents are a flat library — associating a document
    with a conversation is the caller's job (stored in the Aegra thread's
    metadata), not this service's.

    Raises ValueError if the file is not a PDF.
    """
    # Validate file type
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        filename = file.filename or ""
        if not filename.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are supported.")

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > settings.max_upload_size:
        raise ValueError(
            f"File too large. Maximum size is {settings.max_upload_size // (1024 * 1024)}MB."
        )

    # Generate a unique filename to avoid collisions
    original_filename = _safe_display_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    # Ensure upload directory exists
    os.makedirs(settings.upload_dir, exist_ok=True)

    # Save the file to disk
    with open(file_path, "wb") as f:
        f.write(content)

    logger.info("Saved uploaded PDF", filename=original_filename, path=file_path, size=len(content))

    # Create the document record. The ingestion worker will fill page_count,
    # extracted_text, chunks, and embeddings asynchronously.
    document = Document(
        filename=original_filename,
        file_path=file_path,
        extracted_text=None,
        page_count=0,
        status=DOCUMENT_STATUS_PENDING,
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)

    # Hand off chunking + embedding to the background worker. If the queue is
    # unreachable, surface it as a failed ingestion rather than failing the
    # upload — the file is already safely stored.
    try:
        enqueue_ingestion(document.id)
    except Exception:
        logger.exception("Failed to enqueue ingestion", document_id=document.id)
        document.status = DOCUMENT_STATUS_FAILED
        document.error = "Could not enqueue document for processing."
        await session.commit()
        await session.refresh(document)

    return document


async def get_document(session: AsyncSession, document_id: str) -> Document | None:
    """Get a document by its ID."""
    stmt = select(Document).where(Document.id == document_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_documents(session: AsyncSession) -> list[Document]:
    """List every document, most recently uploaded first."""
    stmt = select(Document).order_by(Document.uploaded_at.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def reprocess_document(session: AsyncSession, document_id: str) -> Document | None:
    """Re-enqueue a document for ingestion (e.g. after a failure).

    Resets the document to ``pending`` and pushes a fresh ingestion job. Returns
    the updated document, or None if it does not exist.
    """
    document = await get_document(session, document_id)
    if document is None:
        return None

    document.status = DOCUMENT_STATUS_PENDING
    document.error = None
    await session.commit()
    await session.refresh(document)

    try:
        enqueue_ingestion(document.id)
    except Exception:
        logger.exception("Failed to enqueue document reprocessing", document_id=document.id)
        document.status = DOCUMENT_STATUS_FAILED
        document.error = "Could not enqueue document for processing."
        await session.commit()
        await session.refresh(document)

    return document


async def delete_document(session: AsyncSession, document_id: str) -> bool:
    """Delete a document record and its file on disk.

    Returns True if the document existed and was deleted, False otherwise. The
    file removal is best-effort: a missing file on disk does not block deleting
    the database record.
    """
    document = await get_document(session, document_id)
    if document is None:
        return False

    file_path = document.file_path
    await session.delete(document)
    await session.commit()

    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            logger.warning("Failed to remove document file from disk", path=file_path)

    return True


def _safe_display_filename(filename: str | None) -> str:
    """Return a filesystem-safe filename while preserving a useful display name."""
    candidate = PurePath(filename or DEFAULT_DOCUMENT_FILENAME).name.strip()
    if not candidate:
        candidate = DEFAULT_DOCUMENT_FILENAME

    sanitized = "".join(
        character if character.isprintable() and character not in {"/", "\\", "\0"} else "_"
        for character in candidate
    ).strip(". ")
    if not sanitized:
        sanitized = DEFAULT_DOCUMENT_FILENAME

    if not sanitized.lower().endswith(".pdf"):
        sanitized = f"{sanitized}.pdf"

    if len(sanitized) <= MAX_STORED_FILENAME_LENGTH:
        return sanitized

    stem = sanitized[:-4].rstrip(". ")
    return f"{stem[: MAX_STORED_FILENAME_LENGTH - 4]}.pdf"
