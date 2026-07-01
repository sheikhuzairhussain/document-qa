from __future__ import annotations

import pytest

from backend.agents.qa_agent import context, middleware, sandbox, tools
from backend.lib.services.retrieval import DocumentChunkText, DocumentInfo, RetrievedChunk


def test_get_focus_document_ids_preserves_missing_vs_empty_context() -> None:
    assert context.get_focus_document_ids({}) is None
    assert context.get_focus_document_ids({"focus_documents": []}) == []
    assert context.get_focus_document_ids({"focus_documents": ["doc_1", "", 7]}) == ["doc_1"]


def test_get_available_documents_parses_all_and_explicit_allow_list() -> None:
    assert context.get_available_documents({}) is None
    assert context.get_available_documents({"available_documents": "all"}) == "all"
    assert context.get_available_documents({"available_documents": ["doc_1", "", None]}) == [
        "doc_1"
    ]
    assert context.get_available_documents({"available_documents": "unexpected"}) == []


def test_hidden_focus_context_lists_metadata_and_sanitizes_newlines() -> None:
    hidden_context = middleware.format_hidden_focus_context(
        ["doc_1", "doc_2"],
        [
            DocumentInfo(
                document_id="doc_1",
                filename="Lease\nAgreement.pdf",
                status="completed",
                page_count=12,
                chunk_count=12,
            )
        ],
    )

    assert "[Hidden focus document context]" in hidden_context
    assert "filename='Lease Agreement.pdf'" in hidden_context
    assert "id='doc_1'" in hidden_context
    assert "id='doc_2'; metadata unavailable" in hidden_context
    assert hidden_context.endswith("[/Hidden focus document context]")


def test_format_chunks_includes_citation_contract_and_artifact_metadata() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk_1",
        document_id="doc_1",
        filename="lease.pdf",
        chunk_index=0,
        content="The rent is £1,000.",
        page_no=4,
        headings="Rent",
        score=0.5,
    )

    content = tools.format_retrieved_chunks([chunk])
    artifact = tools.document_sources_artifact([chunk])

    assert "[retrieved_chunk 1]" in content
    assert "chunk_id: chunk_1" in content
    assert "document_id: doc_1" in content
    assert "source: lease.pdf — p.4 — Rent" in content
    assert "citation_marker_start: [[cite:chunk_1|" in content
    assert "The rent is £1,000." in content
    assert artifact == {
        "type": "document_sources_v1",
        "chunks": [
            {
                "chunk_id": "chunk_1",
                "document_id": "doc_1",
                "filename": "lease.pdf",
                "page_no": 4,
                "chunk_index": 0,
            }
        ],
    }


def test_format_document_chunks_handles_visual_only_pages() -> None:
    content = tools.format_document_chunks(
        [
            DocumentChunkText(
                chunk_id="chunk_1",
                document_id="doc_1",
                filename="scan.pdf",
                chunk_index=0,
                content="",
                page_no=1,
                headings=None,
            )
        ]
    )

    assert "Full document text from: scan.pdf" in content
    assert "Indexed chunks: 1" in content
    assert "[No extractable text on this page" in content


@pytest.mark.parametrize(
    ("raw_path", "expected"),
    [
        ("report.pdf", "/home/user/report.pdf"),
        ("~/report.pdf", "/home/user/report.pdf"),
        ("/tmp/../home/user/report.pdf", "/home/user/report.pdf"),
    ],
)
def test_normalize_sandbox_file_path(raw_path: str, expected: str) -> None:
    assert tools.normalize_sandbox_file_path(raw_path) == expected


def test_normalize_sandbox_file_path_rejects_empty_paths() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        tools.normalize_sandbox_file_path("  ")


def test_download_url_artifact_shape() -> None:
    assert tools.download_url_artifact(file_path="/home/user/report.pdf", url="https://x") == {
        "type": "sandbox_download_url_v1",
        "file_path": "/home/user/report.pdf",
        "url": "https://x",
        "expires_in_seconds": tools.DOWNLOAD_URL_EXPIRATION_SECONDS,
        "error": None,
    }


def test_get_thread_id_reads_configurable_thread_id() -> None:
    assert sandbox.get_thread_id(None) is None
    assert sandbox.get_thread_id({"configurable": {}}) is None
    assert sandbox.get_thread_id({"configurable": {"thread_id": "  "}}) is None
    assert sandbox.get_thread_id({"configurable": {"thread_id": "thread_1"}}) == "thread_1"
