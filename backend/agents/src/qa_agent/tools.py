"""Tools exposed to the qa-agent."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

import structlog
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime

from qa_agent.context import (
    SELECT_ALL_DOCUMENTS,
    AgentContext,
    get_available_documents,
)
from qa_agent.retrieval import (
    DocumentChunkText,
    RetrievedChunk,
    get_document_chunks,
    hybrid_search,
)

logger = structlog.get_logger()


class DocumentSourceChunk(TypedDict):
    chunk_id: str
    document_id: str
    filename: str
    page_no: int | None
    chunk_index: int


class DocumentSourcesArtifact(TypedDict):
    type: Literal["document_sources_v1"]
    chunks: list[DocumentSourceChunk]


def _empty_artifact() -> DocumentSourcesArtifact:
    return {"type": "document_sources_v1", "chunks": []}


def _source_chunk(chunk: RetrievedChunk | DocumentChunkText) -> DocumentSourceChunk:
    return {
        "chunk_id": chunk.chunk_id,
        "document_id": chunk.document_id,
        "filename": chunk.filename,
        "page_no": chunk.page_no,
        "chunk_index": chunk.chunk_index,
    }


def _artifact_for_chunks(
    chunks: list[RetrievedChunk] | list[DocumentChunkText],
) -> DocumentSourcesArtifact:
    return {
        "type": "document_sources_v1",
        "chunks": [_source_chunk(chunk) for chunk in chunks],
    }


def _format_source_header(
    chunk: RetrievedChunk | DocumentChunkText,
    *,
    chunk_index: int | None = None,
) -> str:
    location_parts: list[str] = [chunk.filename]
    if chunk.page_no is not None:
        location_parts.append(f"p.{chunk.page_no}")
    else:
        resolved_chunk_index = chunk.chunk_index if chunk_index is None else chunk_index
        location_parts.append(f"chunk {resolved_chunk_index + 1}")
    if chunk.headings:
        location_parts.append(chunk.headings)

    return (
        f"chunk_id: {chunk.chunk_id}\n"
        f"document_id: {chunk.document_id}\n"
        f"source: {' — '.join(location_parts)}\n"
        f"citation_marker: [[cite:{chunk.chunk_id}|<exact text copied from this chunk>]]"
    )


def _format_chunks(chunks: list[RetrievedChunk]) -> str:
    """Render retrieved chunks as a citation-friendly string for the model."""
    if not chunks:
        return (
            "No matching passages were found in the indexed documents. The answer "
            "may not be in the available documents, or they may still be indexing."
        )

    blocks: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        content = chunk.content.strip() or (
            "[No extractable text on this page; retrieved from the page's visual/PDF embedding.]"
        )
        blocks.append(
            f"[retrieved_chunk {i}]\n{_format_source_header(chunk, chunk_index=i - 1)}\n\n{content}"
        )
    return "\n\n".join(blocks)


def _format_document_chunks(chunks: list[DocumentChunkText]) -> str:
    """Render one document's chunks as page-ordered citeable source blocks."""
    if not chunks:
        return (
            "No indexed chunks were found for that document. It may still be "
            "indexing, ingestion may have failed, or the document id may be invalid."
        )

    first = chunks[0]
    blocks = [
        f"Full document text from: {first.filename}",
        f"Indexed chunks: {len(chunks)}",
        (
            "Cite any quoted or relied-on text using the chunk_id shown on each "
            "source block and this exact marker format: "
            "[[cite:<chunk_id>|<exact text copied from that chunk>]]."
        ),
    ]

    for i, chunk in enumerate(chunks, start=1):
        content = chunk.content.strip() or (
            "[No extractable text on this page; the page may still have a visual/PDF embedding.]"
        )
        blocks.append(f"[document_chunk {i}]\n{_format_source_header(chunk)}\n\n{content}")

    return "\n\n".join(blocks)


@tool(parse_docstring=True, response_format="content_and_artifact")
def search_documents(
    query: str,
    runtime: ToolRuntime[AgentContext, Any],
    document_ids: list[str] | None = None,
) -> tuple[str, DocumentSourcesArtifact]:
    """Search available legal documents for passages relevant to a query.

    Use this for every factual question about the documents. Run it (possibly
    several times with different phrasings) before answering, and ground your
    answer only in what it returns, adding inline citation markers for every
    document-derived claim.

    Args:
        query: A focused natural-language search query describing what to find.
        document_ids: Optional list of document ids to restrict the search to.
            Omit to search all available documents. If supplied, these ids are
            intersected with the run's available_documents allow-list.
    """
    effective_document_ids = _effective_document_ids(document_ids, runtime)
    if effective_document_ids == []:
        logger.info(
            "search_documents_skipped_empty_scope",
            query=query,
            requested_document_ids=document_ids,
        )
        if document_ids:
            return (
                "None of the requested document ids are available for retrieval. "
                "Search again without document_ids, or use only focus or checked "
                "library documents.",
                _empty_artifact(),
            )
        return (
            "No documents are available for retrieval. Ask the user to add "
            "documents to focus or check library documents before answering "
            "document-specific questions.",
            _empty_artifact(),
        )

    chunks = hybrid_search(query, document_ids=effective_document_ids)
    logger.info(
        "search_documents",
        query=query,
        requested_document_ids=document_ids,
        effective_document_ids=effective_document_ids,
        results=len(chunks),
    )
    return _format_chunks(chunks), _artifact_for_chunks(chunks)


@tool(parse_docstring=True, response_format="content_and_artifact")
def read_document(
    document_id: str,
    runtime: ToolRuntime[AgentContext, Any],
) -> tuple[str, DocumentSourcesArtifact]:
    """Read all indexed chunks for one available document.

    Use this when the hidden focus document metadata provides a document id and
    the user asks about that whole document, or when full indexed text is more
    useful than targeted search results. Cite the returned filename/page source
    blocks with inline citation markers just like search_documents results.

    Args:
        document_id: The document id to read. It must be in available_documents,
            or available_documents must be "all".
    """
    if not _is_document_available(document_id, runtime):
        logger.info("read_document_denied_unavailable", document_id=document_id)
        return (
            "That document is not available for retrieval in this chat. Use one "
            "of the focus document ids or checked library document ids.",
            _empty_artifact(),
        )

    chunks = get_document_chunks(document_id)
    logger.info(
        "read_document",
        document_id=document_id,
        chunks=len(chunks),
    )
    return _format_document_chunks(chunks), _artifact_for_chunks(chunks)


def _effective_document_ids(
    requested_document_ids: list[str] | None,
    runtime: ToolRuntime[AgentContext, Any],
) -> list[str] | None:
    available_documents = get_available_documents(runtime.context)
    if available_documents is None or available_documents == SELECT_ALL_DOCUMENTS:
        return requested_document_ids

    if not available_documents:
        return []

    if requested_document_ids is None:
        return available_documents

    allowed = set(available_documents)
    return [doc_id for doc_id in requested_document_ids if doc_id in allowed]


def _is_document_available(
    document_id: str,
    runtime: ToolRuntime[AgentContext, Any],
) -> bool:
    available_documents = get_available_documents(runtime.context)
    if available_documents is None or available_documents == SELECT_ALL_DOCUMENTS:
        return True
    return document_id in available_documents
