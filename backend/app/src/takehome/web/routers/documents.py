from __future__ import annotations

import os
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from takehome.db.session import get_session
from takehome.services.document import (
    delete_document,
    get_document,
    list_documents,
    reprocess_document,
    upload_document,
)

logger = structlog.get_logger()

router = APIRouter(tags=["documents"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class DocumentOut(BaseModel):
    id: str
    filename: str
    page_count: int
    uploaded_at: datetime
    # Ingestion status, so the frontend can show indexing progress and gate
    # querying until a document is "completed".
    status: str
    chunk_count: int
    error: str | None = None

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get("/api/documents", response_model=list[DocumentOut])
async def list_documents_endpoint(
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    """List every uploaded document (a flat library)."""
    documents = await list_documents(session)
    return [DocumentOut.model_validate(doc) for doc in documents]


@router.post("/api/documents", response_model=DocumentOut, status_code=201)
async def upload_document_endpoint(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    """Upload a PDF document into the library and start background ingestion.

    Documents are not tied to a conversation here; the caller associates the
    returned document id with an Aegra thread via that thread's metadata.
    """
    try:
        document = await upload_document(session, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    logger.info(
        "Document uploaded",
        document_id=document.id,
        filename=document.filename,
    )

    return DocumentOut.model_validate(document)


@router.post("/api/documents/{document_id}/reprocess", response_model=DocumentOut)
async def reprocess_document_endpoint(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    """Re-run ingestion for a document (e.g. to retry after a failure)."""
    document = await reprocess_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info("Document re-queued for ingestion", document_id=document_id)
    return DocumentOut.model_validate(document)


@router.delete("/api/documents/{document_id}", status_code=204)
async def delete_document_endpoint(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a document and its underlying file."""
    deleted = await delete_document(session, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info("Document deleted", document_id=document_id)


@router.get("/api/documents/{document_id}/content")
async def serve_document_file(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    """Serve the raw PDF file for download/viewing."""
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=document.file_path,
        filename=document.filename,
        media_type="application/pdf",
    )
