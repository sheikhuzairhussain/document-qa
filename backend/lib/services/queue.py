from __future__ import annotations

import structlog
from redis import Redis
from rq import Queue

from backend.config import settings

logger = structlog.get_logger()

# The job function is referenced by dotted path rather than imported, keeping
# enqueueing cheap and avoiding worker-only ingestion imports in the API path.
INGESTION_JOB = "backend.lib.services.ingestion.process_document"
QUEUE_NAME = "ingestion"

_redis: Redis | None = None
_queue: Queue | None = None


def get_queue() -> Queue:
    """Lazily construct the RQ queue backed by Redis."""
    global _redis, _queue
    if _queue is None:
        _redis = Redis.from_url(settings.redis_url)
        _queue = Queue(QUEUE_NAME, connection=_redis)
    return _queue


def enqueue_ingestion(document_id: str) -> None:
    """Enqueue a document for chunking + embedding by the ingestion worker."""
    queue = get_queue()
    queue.enqueue(
        INGESTION_JOB,
        document_id,
        job_timeout=900,  # PDFs can be large; give page embedding room.
    )
    logger.info("Enqueued document for ingestion", document_id=document_id)
