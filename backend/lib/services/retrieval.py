"""Hybrid document retrieval shared by API-adjacent services and agents.

Agents run against their own orchestration database, while document chunks live
in the main application database. This service connects to that document store
directly and runs hybrid search:

* dense  — pgvectorscale StreamingDiskANN over ``embedding`` (cosine ``<=>``), and
* sparse — pg_textsearch BM25 over ``content`` (the ``<@>`` operator),

fused with reciprocal rank fusion (RRF). This mirrors Timescale's reference
hybrid-search query.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Final

from google import genai
from google.genai import types
from psycopg import Connection
from psycopg.rows import DictRow, dict_row

from backend.config import settings
from backend.lib.logging import scoped_logger

logger = scoped_logger("services:retrieval")

# RRF constant. 60 is the canonical default from the original RRF paper and the
# value Timescale uses in its hybrid-search example.
RRF_K = 60
DEFAULT_EMBEDDING_MODEL: Final = "gemini-embedding-2"
DEFAULT_EMBEDDING_DIM: Final = 1536

# Index name created in migration 003; pg_textsearch's to_bm25query() resolves
# the query against this specific BM25 index.
BM25_INDEX = "document_chunks_bm25_idx"

_HYBRID_SQL = f"""
WITH bm25_results AS (
    SELECT id, ROW_NUMBER() OVER (
        ORDER BY content <@> to_bm25query(%(query)s, '{BM25_INDEX}')
    ) AS rank
    FROM document_chunks
    WHERE (%(doc_ids)s::text[] IS NULL OR document_id = ANY(%(doc_ids)s::text[]))
    ORDER BY content <@> to_bm25query(%(query)s, '{BM25_INDEX}')
    LIMIT %(candidates)s
),
vector_results AS (
    SELECT id, ROW_NUMBER() OVER (
        ORDER BY embedding <=> %(qvec)s::vector
    ) AS rank
    FROM document_chunks
    WHERE embedding IS NOT NULL
      AND (%(doc_ids)s::text[] IS NULL OR document_id = ANY(%(doc_ids)s::text[]))
    ORDER BY embedding <=> %(qvec)s::vector
    LIMIT %(candidates)s
)
SELECT
    c.id,
    c.document_id,
    d.filename,
    c.chunk_index,
    c.content,
    c.page_no,
    c.headings,
    COALESCE(1.0 / (%(k)s + b.rank), 0)
        + COALESCE(1.0 / (%(k)s + v.rank), 0) AS rrf_score
FROM document_chunks c
JOIN documents d ON d.id = c.document_id
LEFT JOIN bm25_results b ON b.id = c.id
LEFT JOIN vector_results v ON v.id = c.id
WHERE b.id IS NOT NULL OR v.id IS NOT NULL
ORDER BY rrf_score DESC
LIMIT %(limit)s
"""


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    filename: str
    chunk_index: int
    content: str
    page_no: int | None
    headings: str | None
    score: float


@dataclass(frozen=True)
class DocumentInfo:
    document_id: str
    filename: str
    status: str
    page_count: int
    chunk_count: int


@dataclass(frozen=True)
class DocumentChunkText:
    chunk_id: str
    document_id: str
    filename: str
    chunk_index: int
    content: str
    page_no: int | None
    headings: str | None


@dataclass(frozen=True)
class EmbeddingSettings:
    model: str
    dimensions: int


def _embedding_settings() -> EmbeddingSettings:
    return EmbeddingSettings(
        model=settings.embedding_model or DEFAULT_EMBEDDING_MODEL,
        dimensions=settings.embedding_dim or DEFAULT_EMBEDDING_DIM,
    )


def _embed_query(text: str) -> str:
    """Embed the query and return a pgvector literal (e.g. ``[0.1,0.2,...]``).

    Gemini Embedding 2 does not support ``task_type``; for text queries, Google
    recommends putting the retrieval task in the input text. Returning the
    literal string (cast to ``::vector`` in SQL) avoids depending on a
    driver-specific vector adapter.

    LangGraph may execute several tool calls in parallel. Keep the Gemini client
    local to this call so parallel queries don't share a closable httpx client.
    """
    embedding_settings = _embedding_settings()
    prepared_query = f"task: question answering | query: {text}"
    started_at = time.perf_counter()
    with genai.Client() as client:
        response = client.models.embed_content(
            model=embedding_settings.model,
            contents=prepared_query,
            config=types.EmbedContentConfig(
                output_dimensionality=embedding_settings.dimensions,
            ),
        )
    embedding = embedding_values(response, embedding_settings)
    logger.debug(
        "Retrieval query embedding completed",
        query_chars=len(text),
        model=embedding_settings.model,
        dimensions=embedding_settings.dimensions,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return _vector_literal(embedding)


def embedding_values(
    response: types.EmbedContentResponse,
    settings: EmbeddingSettings,
) -> list[float]:
    embeddings = response.embeddings or []
    if not embeddings:
        raise RuntimeError("Embedding provider returned no query embedding.")

    values = list(embeddings[0].values or [])
    if len(values) != settings.dimensions:
        raise RuntimeError(
            "Embedding provider returned "
            f"{len(values)} dimensions; expected {settings.dimensions}."
        )
    return _normalize(values)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        return vector
    return [value / norm for value in vector]


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(value) for value in vector) + "]"


def database_url() -> str:
    url = settings.rag_database_url
    if not url:
        logger.error("RAG database URL missing")
        raise RuntimeError(
            "RAG_DATABASE_URL is not set; the qa-agent needs it to reach the "
            "document chunks in the main application database."
        )
    return url


def hybrid_search(
    query: str,
    document_ids: list[str] | None = None,
    *,
    limit: int = 8,
    candidates: int = 20,
) -> list[RetrievedChunk]:
    """Return the top ``limit`` chunks for ``query`` via RRF hybrid search.

    ``document_ids`` optionally restricts the search to specific documents;
    ``None`` searches every ingested document. ``candidates`` is how many results
    each ranking (BM25, vector) contributes before fusion.
    """
    started_at = time.perf_counter()
    search_all_documents = document_ids is None
    logger.info(
        "Hybrid search started",
        query_chars=len(query),
        search_all_documents=search_all_documents,
        document_filter_count=None if document_ids is None else len(document_ids),
        limit=limit,
        candidates=candidates,
    )
    try:
        qvec = _embed_query(query)
        params = {
            "query": query,
            "qvec": qvec,
            "doc_ids": document_ids,  # None -> search all documents
            "candidates": candidates,
            "k": RRF_K,
            "limit": limit,
        }

        with Connection[DictRow].connect(database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(_HYBRID_SQL, params)
                rows = cur.fetchall()

        chunks = [
            RetrievedChunk(
                chunk_id=row["id"],
                document_id=row["document_id"],
                filename=row["filename"],
                chunk_index=row["chunk_index"],
                content=row["content"],
                page_no=row["page_no"],
                headings=row["headings"],
                score=float(row["rrf_score"]),
            )
            for row in rows
        ]
    except Exception:
        logger.exception(
            "Hybrid search failed",
            query_chars=len(query),
            search_all_documents=search_all_documents,
            document_filter_count=None if document_ids is None else len(document_ids),
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        raise

    logger.info(
        "Hybrid search completed",
        query_chars=len(query),
        result_count=len(chunks),
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return chunks


def get_documents(document_ids: list[str]) -> list[DocumentInfo]:
    """Fetch citation and status metadata for the given documents."""
    if not document_ids:
        logger.debug("Document metadata lookup skipped; no document ids provided")
        return []

    started_at = time.perf_counter()
    with Connection[DictRow].connect(database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, status, page_count, chunk_count
                FROM documents
                WHERE id = ANY(%(doc_ids)s::text[])
                ORDER BY array_position(%(doc_ids)s::text[], id)
                """,
                {"doc_ids": document_ids},
            )
            rows = cur.fetchall()

    documents = [
        DocumentInfo(
            document_id=row["id"],
            filename=row["filename"],
            status=row["status"],
            page_count=row["page_count"],
            chunk_count=row["chunk_count"],
        )
        for row in rows
    ]
    logger.info(
        "Document metadata lookup completed",
        requested_count=len(document_ids),
        found_count=len(documents),
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return documents


def get_document_chunks(document_id: str) -> list[DocumentChunkText]:
    """Fetch all indexed chunks for a document in citation-friendly order."""
    started_at = time.perf_counter()
    logger.info("Document chunk lookup started", document_id=document_id)
    with Connection[DictRow].connect(database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id,
                    c.document_id,
                    d.filename,
                    c.chunk_index,
                    c.content,
                    c.page_no,
                    c.headings
                FROM document_chunks c
                JOIN documents d ON d.id = c.document_id
                WHERE c.document_id = %(document_id)s
                ORDER BY c.chunk_index ASC, c.page_no NULLS LAST, c.id ASC
                """,
                {"document_id": document_id},
            )
            rows = cur.fetchall()

    chunks = [
        DocumentChunkText(
            chunk_id=row["id"],
            document_id=row["document_id"],
            filename=row["filename"],
            chunk_index=row["chunk_index"],
            content=row["content"],
            page_no=row["page_no"],
            headings=row["headings"],
        )
        for row in rows
    ]
    logger.info(
        "Document chunk lookup completed",
        document_id=document_id,
        chunk_count=len(chunks),
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return chunks
