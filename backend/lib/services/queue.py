from __future__ import annotations

from redis import Redis
from rq import Queue

from backend.config import settings
from backend.lib.logging import scoped_logger

logger = scoped_logger("services:queue")

# The job function is referenced by dotted path rather than imported, keeping
# enqueueing cheap and avoiding worker-only ingestion imports in the API path.
INGESTION_JOB = "backend.worker.jobs.process_document"
QUEUE_NAME = "ingestion"

_redis: Redis | None = None
_queue: Queue | None = None


def get_queue() -> Queue:
    """Lazily construct the RQ queue backed by Redis."""
    global _redis, _queue
    if _queue is None:
        _redis = Redis.from_url(settings.redis_url)
        _queue = Queue(QUEUE_NAME, connection=_redis)
        logger.info(
            "Ingestion queue initialized",
            queue_name=QUEUE_NAME,
            redis_url=settings.redis_url,
        )
    return _queue


def enqueue_ingestion(document_id: str) -> None:
    """Enqueue a document for chunking + embedding by the ingestion worker."""
    queue = get_queue()
    job = queue.enqueue(
        INGESTION_JOB,
        document_id,
        job_timeout=900,  # PDFs can be large; give page embedding room.
    )
    logger.info(
        "Document enqueued for ingestion",
        document_id=document_id,
        queue_name=QUEUE_NAME,
        job_id=job.id,
        job_timeout_seconds=900,
    )
