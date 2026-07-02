from __future__ import annotations

import time

from backend.lib.logging import scoped_logger
from backend.lib.services.ingestion import process_document as process_document_ingestion

logger = scoped_logger("workers:ingestion")


def process_document(document_id: str) -> None:
    """RQ job adapter for document ingestion."""
    started_at = time.perf_counter()
    logger.info("Worker ingestion job received", document_id=document_id)
    try:
        process_document_ingestion(document_id)
    except Exception:
        logger.exception(
            "Worker ingestion job failed",
            document_id=document_id,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        raise
    logger.info(
        "Worker ingestion job completed",
        document_id=document_id,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
