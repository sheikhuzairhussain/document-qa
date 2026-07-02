from __future__ import annotations

import os
import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import PurePath
from types import TracebackType
from typing import Any, Protocol

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.engine import Result, ScalarResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Executable

from backend.config import settings
from backend.lib.db.models import (
    DOCUMENT_STATUS_FAILED,
    DOCUMENT_STATUS_PENDING,
    Document,
)
from backend.lib.db.session import async_session
from backend.lib.logging import scoped_logger
from backend.lib.services.queue import enqueue_ingestion

logger = scoped_logger("services:documents")

DEFAULT_DOCUMENT_FILENAME = "document.pdf"
MAX_STORED_FILENAME_LENGTH = 180

type DocumentSessionContextFactory = Callable[[], AbstractAsyncContextManager[DocumentSession]]
type EnqueueIngestion = Callable[[str], None]


@dataclass(frozen=True)
class DocumentFile:
    path: str
    filename: str
    media_type: str = "application/pdf"


class DocumentFileMissingError(FileNotFoundError):
    """Raised when a document record exists but its stored file is missing."""


class DocumentScalarResult(Protocol):
    def all(self) -> Sequence[Document]: ...


class DocumentExecuteResult(Protocol):
    def scalar_one_or_none(self) -> Document | None: ...
    def scalars(self) -> DocumentScalarResult: ...


class DocumentSession(Protocol):
    def add(self, instance: object, _warn: bool = True) -> None: ...
    async def commit(self) -> None: ...
    async def refresh(self, instance: object) -> None: ...
    async def delete(self, instance: object) -> None: ...
    async def execute(self, statement: Executable) -> DocumentExecuteResult: ...


class _SqlAlchemyDocumentScalarResult:
    def __init__(self, result: ScalarResult[Any]) -> None:
        self._result = result

    def all(self) -> Sequence[Document]:
        return [_require_document(value) for value in self._result.all()]


class _SqlAlchemyDocumentExecuteResult:
    def __init__(self, result: Result[Any]) -> None:
        self._result = result

    def scalar_one_or_none(self) -> Document | None:
        value = self._result.scalar_one_or_none()
        if value is None:
            return None
        return _require_document(value)

    def scalars(self) -> DocumentScalarResult:
        return _SqlAlchemyDocumentScalarResult(self._result.scalars())


class _SqlAlchemyDocumentSession:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, instance: object, _warn: bool = True) -> None:
        self._session.add(instance, _warn=_warn)

    async def commit(self) -> None:
        await self._session.commit()

    async def refresh(self, instance: object) -> None:
        await self._session.refresh(instance)

    async def delete(self, instance: object) -> None:
        await self._session.delete(instance)

    async def execute(self, statement: Executable) -> DocumentExecuteResult:
        return _SqlAlchemyDocumentExecuteResult(await self._session.execute(statement))


class _SqlAlchemySessionContext:
    def __init__(self) -> None:
        self._context = async_session()

    async def __aenter__(self) -> DocumentSession:
        return _SqlAlchemyDocumentSession(await self._context.__aenter__())

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        return await self._context.__aexit__(exc_type, exc, traceback)


def _default_session_context() -> AbstractAsyncContextManager[DocumentSession]:
    return _SqlAlchemySessionContext()


def _require_document(value: object) -> Document:
    if isinstance(value, Document):
        return value
    msg = f"Expected Document row, got {type(value).__name__}."
    raise TypeError(msg)


class DocumentService:
    """Application service for document library operations."""

    def __init__(
        self,
        *,
        session_factory: DocumentSessionContextFactory = _default_session_context,
        enqueue: EnqueueIngestion = enqueue_ingestion,
    ) -> None:
        self._session_factory = session_factory
        self._enqueue = enqueue

    async def upload_document(self, file: UploadFile) -> Document:
        """Upload a PDF document and enqueue background ingestion."""
        logger.info(
            "Document upload started",
            filename=file.filename,
            content_type=file.content_type,
        )
        async with self._session_factory() as session:
            document = await _upload_document(session, file, enqueue=self._enqueue)
        logger.info(
            "Document upload completed",
            document_id=document.id,
            filename=document.filename,
            status=document.status,
        )
        return document

    async def get_document(self, document_id: str) -> Document | None:
        """Get a document by its ID."""
        async with self._session_factory() as session:
            return await _get_document(session, document_id)

    async def list_documents(self) -> list[Document]:
        """List every document, most recently uploaded first."""
        async with self._session_factory() as session:
            stmt = select(Document).order_by(Document.uploaded_at.desc())
            result = await session.execute(stmt)
            documents = list(result.scalars().all())
        logger.info("Documents loaded", count=len(documents))
        return documents

    async def reprocess_document(self, document_id: str) -> Document | None:
        """Re-enqueue a document for ingestion after resetting its status."""
        async with self._session_factory() as session:
            document = await _get_document(session, document_id)
            if document is None:
                logger.warning("Document reprocess skipped; document not found", document_id=document_id)
                return None

            logger.info("Document reprocess requested", document_id=document_id)
            document.status = DOCUMENT_STATUS_PENDING
            document.error = None
            await session.commit()
            await session.refresh(document)

            try:
                self._enqueue(document.id)
            except Exception:
                logger.exception(
                    "Failed to enqueue document reprocessing",
                    document_id=document.id,
                )
                document.status = DOCUMENT_STATUS_FAILED
                document.error = "Could not enqueue document for processing."
                await session.commit()
                await session.refresh(document)
            else:
                logger.info("Document reprocess enqueued", document_id=document.id)

            return document

    async def delete_document(self, document_id: str) -> bool:
        """Delete a document record and its stored file."""
        async with self._session_factory() as session:
            document = await _get_document(session, document_id)
            if document is None:
                logger.warning("Document delete skipped; document not found", document_id=document_id)
                return False

            file_path = document.file_path
            filename = document.filename
            await session.delete(document)
            await session.commit()
            logger.info(
                "Document record deleted",
                document_id=document_id,
                filename=filename,
            )

        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info("Document file removed", document_id=document_id, path=file_path)
            except OSError:
                logger.exception(
                    "Failed to remove document file from disk",
                    document_id=document_id,
                    path=file_path,
                )

        return True

    async def get_document_file(self, document_id: str) -> DocumentFile | None:
        """Resolve a stored PDF file for serving to the frontend."""
        document = await self.get_document(document_id)
        if document is None:
            logger.warning("Document file lookup skipped; document not found", document_id=document_id)
            return None

        if not os.path.exists(document.file_path):
            logger.warning(
                "Document file lookup failed; file missing on disk",
                document_id=document_id,
                path=document.file_path,
            )
            raise DocumentFileMissingError(document.file_path)

        logger.info(
            "Document file resolved",
            document_id=document_id,
            filename=document.filename,
        )
        return DocumentFile(path=document.file_path, filename=document.filename)


default_document_service = DocumentService()


async def upload_document(file: UploadFile) -> Document:
    return await default_document_service.upload_document(file)


async def get_document(document_id: str) -> Document | None:
    return await default_document_service.get_document(document_id)


async def list_documents() -> list[Document]:
    return await default_document_service.list_documents()


async def reprocess_document(document_id: str) -> Document | None:
    return await default_document_service.reprocess_document(document_id)


async def delete_document(document_id: str) -> bool:
    return await default_document_service.delete_document(document_id)


async def get_document_file(document_id: str) -> DocumentFile | None:
    return await default_document_service.get_document_file(document_id)


async def _get_document(session: DocumentSession, document_id: str) -> Document | None:
    stmt = select(Document).where(Document.id == document_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def _upload_document(
    session: DocumentSession,
    file: UploadFile,
    *,
    enqueue: EnqueueIngestion,
) -> Document:
    """Validate, store, persist, and enqueue a document upload."""
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        filename = file.filename or ""
        if not filename.lower().endswith(".pdf"):
            logger.warning(
                "Document upload rejected; unsupported file type",
                filename=file.filename,
                content_type=file.content_type,
            )
            raise ValueError("Only PDF files are supported.")

    content = await file.read()
    if len(content) > settings.max_upload_size:
        logger.warning(
            "Document upload rejected; file too large",
            filename=file.filename,
            size_bytes=len(content),
            max_size_bytes=settings.max_upload_size,
        )
        raise ValueError(
            f"File too large. Maximum size is {settings.max_upload_size // (1024 * 1024)}MB."
        )

    original_filename = safe_display_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    logger.info(
        "Document file saved",
        filename=original_filename,
        path=file_path,
        size_bytes=len(content),
    )

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
    logger.info(
        "Document record created",
        document_id=document.id,
        filename=document.filename,
        status=document.status,
    )

    try:
        enqueue(document.id)
    except Exception:
        logger.exception("Failed to enqueue ingestion", document_id=document.id)
        document.status = DOCUMENT_STATUS_FAILED
        document.error = "Could not enqueue document for processing."
        await session.commit()
        await session.refresh(document)
    else:
        logger.info("Document ingestion enqueued", document_id=document.id)

    return document


def safe_display_filename(filename: str | None) -> str:
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
