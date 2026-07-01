"""Hybrid retrieval for the qa-agent.

The agent runs in its own container against its own (Aegra) database, but the
document chunks live in the *main* application database. This module connects to
that database directly (sync psycopg) and runs hybrid search:

* dense  — pgvectorscale StreamingDiskANN over ``embedding`` (cosine ``<=>``), and
* sparse — pg_textsearch BM25 over ``content`` (the ``<@>`` operator),

fused with reciprocal rank fusion (RRF). This mirrors Timescale's reference
hybrid-search query.

Self-contained on purpose: the agent package can't import ``takehome``, so the
embedding call and SQL are reimplemented here against environment config only.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

from google import genai
from google.genai import types
from psycopg import Connection
from psycopg.rows import DictRow, dict_row

# RRF constant. 60 is the canonical default from the original RRF paper and the
# value Timescale uses in its hybrid-search example.
RRF_K = 60

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


# Dimensionality requested from gemini-embedding-2. Must match the ingestion
# worker and the document_chunks.embedding vector(1536) column.
_EMBEDDING_DIM = 1536


def _embed_query(text: str) -> str:
    """Embed the query and return a pgvector literal (e.g. ``[0.1,0.2,...]``).

    Gemini Embedding 2 does not support ``task_type``; for text queries, Google
    recommends putting the retrieval task in the input text. Returning the
    literal string (cast to ``::vector`` in SQL) avoids depending on a
    driver-specific vector adapter.

    LangGraph may execute several tool calls in parallel. Keep the Gemini client
    local to this call so parallel queries don't share a closable httpx client.
    """
    model = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-2")
    prepared_query = f"task: question answering | query: {text}"
    with genai.Client() as client:
        response = client.models.embed_content(
            model=model,
            contents=prepared_query,
            config=types.EmbedContentConfig(
                output_dimensionality=_EMBEDDING_DIM,
            ),
        )
    embedding = list((response.embeddings or [])[0].values or [])
    norm = math.sqrt(sum(x * x for x in embedding))
    if norm:
        embedding = [x / norm for x in embedding]
    return "[" + ",".join(str(x) for x in embedding) + "]"


def _database_url() -> str:
    url = os.environ.get("RAG_DATABASE_URL")
    if not url:
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
    qvec = _embed_query(query)
    params = {
        "query": query,
        "qvec": qvec,
        "doc_ids": document_ids,  # None -> search all documents
        "candidates": candidates,
        "k": RRF_K,
        "limit": limit,
    }

    with Connection[DictRow].connect(_database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(_HYBRID_SQL, params)
            rows = cur.fetchall()

    return [
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


def get_documents(document_ids: list[str]) -> list[DocumentInfo]:
    """Fetch citation and status metadata for the given documents."""
    if not document_ids:
        return []

    with Connection[DictRow].connect(_database_url(), row_factory=dict_row) as conn:
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

    return [
        DocumentInfo(
            document_id=row["id"],
            filename=row["filename"],
            status=row["status"],
            page_count=row["page_count"],
            chunk_count=row["chunk_count"],
        )
        for row in rows
    ]


def get_document_chunks(document_id: str) -> list[DocumentChunkText]:
    """Fetch all indexed chunks for a document in citation-friendly order."""
    with Connection[DictRow].connect(_database_url(), row_factory=dict_row) as conn:
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

    return [
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
