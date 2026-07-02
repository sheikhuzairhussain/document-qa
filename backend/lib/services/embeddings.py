from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor

from google import genai
from google.genai import types

from backend.config import settings
from backend.lib.logging import scoped_logger

logger = scoped_logger("services:embeddings")

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """Lazily construct the google-genai client.

    Reads ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY`` from the environment
    automatically (config.py exports the user's ``GOOGLE_API_KEY``).
    """
    global _client
    if _client is None:
        _client = genai.Client()
        logger.debug("Gemini embedding client initialized", model=settings.embedding_model)
    return _client


def _normalize(vector: list[float]) -> list[float]:
    """L2-normalize defensively for cosine search."""
    norm = math.sqrt(sum(x * x for x in vector))
    if norm == 0.0:
        return vector
    return [x / norm for x in vector]


def embedding_values(response: types.EmbedContentResponse) -> list[float]:
    embeddings = response.embeddings or []
    if not embeddings:
        raise RuntimeError("Gemini returned no embedding for input.")

    values = list(embeddings[0].values or [])
    if len(values) != settings.embedding_dim:
        raise RuntimeError(
            f"Gemini returned {len(values)} dimensions; expected {settings.embedding_dim}."
        )
    return _normalize(values)


def _embed_pdf_page(client: genai.Client, pdf_bytes: bytes) -> list[float]:
    """Embed one single-page PDF with Gemini Embedding 2."""
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=[
            types.Part.from_bytes(
                data=pdf_bytes,
                mime_type="application/pdf",
            )
        ],
        config=types.EmbedContentConfig(
            output_dimensionality=settings.embedding_dim,
        ),
    )
    return embedding_values(response)


def embed_pdf_pages(page_pdfs: list[bytes]) -> list[list[float]]:
    """Embed single-page PDFs concurrently, preserving page order."""
    if not page_pdfs:
        logger.info("PDF page embedding skipped; no pages provided")
        return []

    client = _get_client()
    max_workers = max(1, min(settings.embedding_concurrency, len(page_pdfs)))
    started_at = time.perf_counter()
    logger.info(
        "PDF page embedding started",
        page_count=len(page_pdfs),
        model=settings.embedding_model,
        dimensions=settings.embedding_dim,
        concurrency=max_workers,
    )

    def embed_page(pdf_bytes: bytes) -> list[float]:
        return _embed_pdf_page(client, pdf_bytes)

    try:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            vectors: list[list[float]] = list(executor.map(embed_page, page_pdfs))
    except Exception:
        logger.exception(
            "PDF page embedding failed",
            page_count=len(page_pdfs),
            concurrency=max_workers,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        raise

    if len(vectors) != len(page_pdfs):
        raise RuntimeError(
            f"Embedding count mismatch: got {len(vectors)} vectors for {len(page_pdfs)} pages."
        )

    logger.info(
        "Embedded PDF pages",
        count=len(vectors),
        model=settings.embedding_model,
        concurrency=max_workers,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return vectors


def prepare_query(text: str) -> str:
    """Format a text query the way Gemini Embedding 2 recommends for QA retrieval."""
    return f"task: question answering | query: {text}"


def embed_query(text: str) -> list[float]:
    """Embed a single text query."""
    started_at = time.perf_counter()
    response = _get_client().models.embed_content(
        model=settings.embedding_model,
        contents=prepare_query(text),
        config=types.EmbedContentConfig(
            output_dimensionality=settings.embedding_dim,
        ),
    )
    values = embedding_values(response)
    logger.debug(
        "Query embedding completed",
        query_chars=len(text),
        model=settings.embedding_model,
        dimensions=settings.embedding_dim,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return values
