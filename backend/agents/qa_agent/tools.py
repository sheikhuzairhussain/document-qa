"""Tools exposed to the qa-agent."""

from __future__ import annotations

import posixpath
from typing import Literal, TypedDict

from e2b import FileNotFoundException, FileType, InvalidArgumentException, SandboxException
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime

from backend.agents.qa_agent.context import (
    SELECT_ALL_DOCUMENTS,
    AgentContext,
    get_available_documents,
)
from backend.agents.qa_agent.sandbox import (
    DOWNLOAD_URL_EXPIRATION_SECONDS,
    get_sandbox,
    get_thread_id,
)
from backend.lib.logging import scoped_logger
from backend.lib.services.retrieval import (
    DocumentChunkText,
    RetrievedChunk,
    get_document_chunks,
    hybrid_search,
)

logger = scoped_logger("agents:qa_agent")

CITATION_MARKER_END = "]]"
SANDBOX_HOME = "/home/user"


class DocumentSourceChunk(TypedDict):
    chunk_id: str
    document_id: str
    filename: str
    page_no: int | None
    chunk_index: int


class DocumentSourcesArtifact(TypedDict):
    type: Literal["document_sources_v1"]
    chunks: list[DocumentSourceChunk]


class SandboxDownloadUrlArtifact(TypedDict):
    type: Literal["sandbox_download_url_v1"]
    file_path: str
    url: str | None
    expires_in_seconds: int
    error: str | None


def _empty_artifact() -> DocumentSourcesArtifact:
    return {"type": "document_sources_v1", "chunks": []}


def _citation_marker_start_for_chunk(chunk_id: str) -> str:
    return f"[[cite:{chunk_id}|"


def _source_chunk(chunk: RetrievedChunk | DocumentChunkText) -> DocumentSourceChunk:
    return {
        "chunk_id": chunk.chunk_id,
        "document_id": chunk.document_id,
        "filename": chunk.filename,
        "page_no": chunk.page_no,
        "chunk_index": chunk.chunk_index,
    }


def document_sources_artifact(
    chunks: list[RetrievedChunk] | list[DocumentChunkText],
) -> DocumentSourcesArtifact:
    return {
        "type": "document_sources_v1",
        "chunks": [_source_chunk(chunk) for chunk in chunks],
    }


def download_url_artifact(
    *,
    file_path: str,
    url: str | None = None,
    error: str | None = None,
) -> SandboxDownloadUrlArtifact:
    return {
        "type": "sandbox_download_url_v1",
        "file_path": file_path,
        "url": url,
        "expires_in_seconds": DOWNLOAD_URL_EXPIRATION_SECONDS,
        "error": error,
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
        f"citation_marker_start: {_citation_marker_start_for_chunk(chunk.chunk_id)}\n"
        f"citation_marker_end: {CITATION_MARKER_END}"
    )


def format_retrieved_chunks(chunks: list[RetrievedChunk]) -> str:
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


def format_document_chunks(chunks: list[DocumentChunkText]) -> str:
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
            "source block. Each source block provides citation_marker_start and "
            "citation_marker_end; place a short exact supporting span copied from "
            "that chunk between them."
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
    runtime: ToolRuntime[AgentContext, object],
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
            "Document search skipped; retrieval scope is empty",
            query_chars=len(query),
            requested_document_count=None if document_ids is None else len(document_ids),
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

    logger.info(
        "Document search started",
        query_chars=len(query),
        requested_document_count=None if document_ids is None else len(document_ids),
        effective_document_count=None
        if effective_document_ids is None
        else len(effective_document_ids),
        search_all_documents=effective_document_ids is None,
    )
    chunks = hybrid_search(query, document_ids=effective_document_ids)
    logger.info(
        "Document search completed",
        query_chars=len(query),
        requested_document_count=None if document_ids is None else len(document_ids),
        effective_document_count=None
        if effective_document_ids is None
        else len(effective_document_ids),
        result_count=len(chunks),
    )
    return format_retrieved_chunks(chunks), document_sources_artifact(chunks)


@tool(parse_docstring=True, response_format="content_and_artifact")
def read_document(
    document_id: str,
    runtime: ToolRuntime[AgentContext, object],
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
        logger.info("Document read denied; document unavailable", document_id=document_id)
        return (
            "That document is not available for retrieval in this chat. Use one "
            "of the focus document ids or checked library document ids.",
            _empty_artifact(),
        )

    logger.info("Document read started", document_id=document_id)
    chunks = get_document_chunks(document_id)
    logger.info(
        "Document read completed",
        document_id=document_id,
        chunk_count=len(chunks),
    )
    return format_document_chunks(chunks), document_sources_artifact(chunks)


@tool(parse_docstring=True, response_format="content_and_artifact")
def get_download_url(
    file_path: str,
    runtime: ToolRuntime[AgentContext, object],
) -> tuple[str, SandboxDownloadUrlArtifact]:
    """Create a pre-signed download URL for a file in this run's sandbox.

    Use this after creating or exporting a file in the sandbox when the user
    needs to download it. Relative paths resolve under /home/user.

    Args:
        file_path: Path to the file inside the E2B sandbox.
    """
    try:
        normalized_path = normalize_sandbox_file_path(file_path)
    except ValueError as exc:
        message = str(exc)
        logger.warning("Sandbox download URL rejected; invalid path", reason=message)
        return message, download_url_artifact(file_path=file_path, error=message)

    thread_id = get_thread_id(runtime.config)
    if thread_id is None:
        message = (
            "No sandbox is available for this run, so a download URL cannot be "
            "created. Run this tool only after sandbox-backed file work."
        )
        logger.warning("Sandbox download URL skipped; no sandbox thread")
        return message, download_url_artifact(file_path=normalized_path, error=message)

    try:
        logger.info(
            "Sandbox download URL creation started",
            thread_id=thread_id,
            file_path=normalized_path,
        )
        sandbox = get_sandbox(thread_id)
        info = sandbox.files.get_info(normalized_path)
        if info.type == FileType.DIR:
            message = f"{normalized_path} is a directory. Provide a file path instead."
            logger.warning(
                "Sandbox download URL rejected; path is a directory",
                thread_id=thread_id,
                file_path=normalized_path,
            )
            return (
                message,
                download_url_artifact(file_path=normalized_path, error=message),
            )

        url = sandbox.download_url(
            normalized_path,
            use_signature_expiration=DOWNLOAD_URL_EXPIRATION_SECONDS,
        )
    except FileNotFoundException:
        message = f"{normalized_path} does not exist in the sandbox."
        logger.warning(
            "Sandbox download URL rejected; file not found",
            thread_id=thread_id,
            file_path=normalized_path,
        )
        return message, download_url_artifact(file_path=normalized_path, error=message)
    except (InvalidArgumentException, SandboxException, RuntimeError) as exc:
        message = f"Could not create a download URL for {normalized_path}: {exc}"
        logger.warning(
            "Sandbox download URL creation failed",
            thread_id=thread_id,
            file_path=normalized_path,
            error=str(exc),
        )
        return message, download_url_artifact(file_path=normalized_path, error=message)

    logger.info(
        "Sandbox download URL created",
        thread_id=thread_id,
        file_path=normalized_path,
        expires_in_seconds=DOWNLOAD_URL_EXPIRATION_SECONDS,
    )
    return (
        (
            f"Download ready for {normalized_path}. The UI will render the "
            f"download link from the tool artifact. Do not include the URL in "
            f"the assistant response text."
        ),
        download_url_artifact(file_path=normalized_path, url=url),
    )


def _effective_document_ids(
    requested_document_ids: list[str] | None,
    runtime: ToolRuntime[AgentContext, object],
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
    runtime: ToolRuntime[AgentContext, object],
) -> bool:
    available_documents = get_available_documents(runtime.context)
    if available_documents is None or available_documents == SELECT_ALL_DOCUMENTS:
        return True
    return document_id in available_documents


def normalize_sandbox_file_path(file_path: str) -> str:
    stripped_path = file_path.strip()
    if not stripped_path:
        msg = "Provide a non-empty sandbox file path."
        raise ValueError(msg)

    if stripped_path == "~" or stripped_path.startswith("~/"):
        stripped_path = posixpath.join(SANDBOX_HOME, stripped_path.removeprefix("~/"))

    if stripped_path.startswith("/"):
        return posixpath.normpath(stripped_path)

    return posixpath.normpath(posixpath.join(SANDBOX_HOME, stripped_path))
