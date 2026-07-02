"""Lightweight page-level document ingestion worker job.

Runs in the RQ ``ingestion`` worker. For each uploaded PDF it:

1. marks the document ``processing``,
2. splits the PDF into single-page PDFs with PyMuPDF,
3. extracts page text,
4. embeds the single-page PDFs with Gemini Embedding 2 concurrently, and
5. stores one searchable row per page.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import fitz

from backend.lib.db.models import (
    DOCUMENT_STATUS_COMPLETED,
    DOCUMENT_STATUS_FAILED,
    DOCUMENT_STATUS_PROCESSING,
    Document,
    DocumentChunk,
)
from backend.lib.db.session import sync_session
from backend.lib.logging import scoped_logger
from backend.lib.services.embeddings import embed_pdf_pages

logger = scoped_logger("services:ingestion")


@dataclass(frozen=True)
class PagePayload:
    page_no: int
    text: str
    pdf_bytes: bytes


def _extract_page_text(page: fitz.Page) -> str:
    """Extract sorted text blocks for a page-level searchable chunk."""
    raw_blocks = page.get_text("blocks", sort=True)
    text_parts: list[str] = []

    for raw_block in raw_blocks:
        if len(raw_block) < 7:
            continue

        _x0, _y0, _x1, _y1, raw_text, _block_no, block_type = raw_block[:7]
        if block_type != 0:
            continue

        block_text = str(raw_text).strip()
        if not block_text:
            continue

        if text_parts:
            text_parts.append("\n\n")
        text_parts.append(block_text)

    return "".join(text_parts)


def _single_page_pdf_bytes(doc: fitz.Document, page_index: int) -> bytes:
    single_page = fitz.open()
    try:
        single_page.insert_pdf(doc, from_page=page_index, to_page=page_index)
        return single_page.tobytes()
    finally:
        single_page.close()


def extract_pdf_pages(file_path: str) -> list[PagePayload]:
    started_at = time.perf_counter()
    logger.info("PDF page extraction started", path=file_path)
    doc = fitz.open(file_path)
    try:
        pages: list[PagePayload] = []
        for page_index in range(len(doc)):
            page = doc[page_index]
            text = _extract_page_text(page)
            pages.append(
                PagePayload(
                    page_no=page_index + 1,
                    text=text,
                    pdf_bytes=_single_page_pdf_bytes(doc, page_index),
                )
            )
        logger.info(
            "PDF page extraction completed",
            path=file_path,
            page_count=len(pages),
            text_chars=sum(len(page.text) for page in pages),
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        return pages
    finally:
        doc.close()


def document_text(pages: list[PagePayload]) -> str | None:
    page_texts = [
        f"--- Page {page.page_no} ---\n{page.text}" for page in pages if page.text.strip()
    ]
    return "\n\n".join(page_texts) if page_texts else None


def process_document(document_id: str) -> None:
    """Extract, embed, and index a single document. Enqueued from upload."""
    log = logger.bind(document_id=document_id)
    started_at = time.perf_counter()
    log.info("Ingestion job started")
    session = sync_session()
    try:
        document = session.get(Document, document_id)
        if document is None:
            log.warning("Document not found; skipping ingestion")
            return

        document.status = DOCUMENT_STATUS_PROCESSING
        document.error = None
        session.commit()
        log.info("Document marked processing", filename=document.filename)

        file_path = document.file_path
        log.info("Document ingestion started", file_path=file_path)

        pages = extract_pdf_pages(file_path)
        if not pages:
            raise ValueError("PDF has no pages.")

        log.info(
            "Document pages extracted",
            page_count=len(pages),
            text_chars=sum(len(page.text) for page in pages),
        )
        log.info("Document page embedding started", page_count=len(pages))
        vectors = embed_pdf_pages([page.pdf_bytes for page in pages])
        log.info("Document page embedding completed", vector_count=len(vectors))

        deleted_chunks = (
            session.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
        )

        for index, (page, vector) in enumerate(zip(pages, vectors, strict=True)):
            session.add(
                DocumentChunk(
                    document_id=document_id,
                    chunk_index=index,
                    content=page.text,
                    page_no=page.page_no,
                    headings=None,
                    token_count=None,
                    embedding=vector,
                )
            )

        document.page_count = len(pages)
        document.extracted_text = document_text(pages)
        document.chunk_count = len(pages)
        document.status = DOCUMENT_STATUS_COMPLETED
        session.commit()
        log.info(
            "Ingestion completed",
            page_count=len(pages),
            deleted_chunks=deleted_chunks,
            inserted_chunks=len(pages),
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )

    except Exception as exc:
        log.exception(
            "Ingestion failed",
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        session.rollback()
        # Best-effort: record the failure on the document so the UI can show it.
        try:
            document = session.get(Document, document_id)
            if document is not None:
                document.status = DOCUMENT_STATUS_FAILED
                document.error = str(exc)[:1000]
                session.commit()
                log.info("Document marked failed after ingestion error")
        except Exception:
            log.exception("Failed to record ingestion failure")
        raise
    finally:
        session.close()
