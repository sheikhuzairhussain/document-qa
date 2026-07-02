from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.responses import FileResponse

from backend.lib.logging import scoped_logger
from backend.lib.services.document import (
    DocumentFileMissingError,
    delete_document,
    get_document_file,
    list_documents,
    reprocess_document,
    upload_document,
)

logger = scoped_logger("routers:documents")

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
async def list_documents_endpoint() -> list[DocumentOut]:
    """List every uploaded document (a flat library)."""
    documents = await list_documents()
    logger.info("Documents listed", count=len(documents))
    return [DocumentOut.model_validate(doc) for doc in documents]


@router.post("/api/documents", response_model=DocumentOut, status_code=201)
async def upload_document_endpoint(
    file: UploadFile,
) -> DocumentOut:
    """Upload a PDF document into the library and start background ingestion.

    Documents are not tied to a conversation here; the caller associates the
    returned document id with an Aegra thread via that thread's metadata.
    """
    try:
        document = await upload_document(file)
    except ValueError as e:
        logger.warning(
            "Document upload rejected",
            filename=file.filename,
            content_type=file.content_type,
            reason=str(e),
        )
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
) -> DocumentOut:
    """Re-run ingestion for a document (e.g. to retry after a failure)."""
    document = await reprocess_document(document_id)
    if document is None:
        logger.warning("Document reprocess requested for missing document", document_id=document_id)
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info("Document re-queued for ingestion", document_id=document_id)
    return DocumentOut.model_validate(document)


@router.delete("/api/documents/{document_id}", status_code=204)
async def delete_document_endpoint(
    document_id: str,
) -> None:
    """Delete a document and its underlying file."""
    deleted = await delete_document(document_id)
    if not deleted:
        logger.warning("Document delete requested for missing document", document_id=document_id)
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info("Document deleted", document_id=document_id)


@router.get("/api/documents/{document_id}/content")
async def serve_document_file(document_id: str) -> FileResponse:
    """Serve the raw PDF file for download/viewing."""
    try:
        document_file = await get_document_file(document_id)
    except DocumentFileMissingError as exc:
        logger.warning("Document file missing on disk", document_id=document_id)
        raise HTTPException(status_code=404, detail="File not found on disk") from exc

    if document_file is None:
        logger.warning("Document content requested for missing document", document_id=document_id)
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info(
        "Document file served",
        document_id=document_id,
        filename=document_file.filename,
        media_type=document_file.media_type,
    )
    return FileResponse(
        path=document_file.path,
        filename=document_file.filename,
        media_type=document_file.media_type,
    )
