from __future__ import annotations

from operator import methodcaller
from pathlib import Path

import fitz
import pytest
from google.genai import types

from backend.lib.db.models import (
    DOCUMENT_STATUS_COMPLETED,
    DOCUMENT_STATUS_FAILED,
    DocumentChunk,
)
from backend.lib.db.models import (
    Document as DbDocument,
)
from backend.lib.services import embeddings, ingestion


def test_prepare_query_adds_retrieval_task_prefix() -> None:
    assert embeddings.prepare_query("What is the rent?") == (
        "task: question answering | query: What is the rent?"
    )


def test_embedding_values_normalizes_and_validates_dimensions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(embeddings.settings, "embedding_dim", 2)
    response = types.EmbedContentResponse(
        embeddings=[types.ContentEmbedding(values=[3.0, 4.0])]
    )

    assert embeddings.embedding_values(response) == [0.6, 0.8]


def test_embedding_values_rejects_empty_response() -> None:
    response = types.EmbedContentResponse(embeddings=[])

    with pytest.raises(RuntimeError, match="no embedding"):
        embeddings.embedding_values(response)


def test_embed_pdf_pages_preserves_order_and_uses_configured_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[bytes] = []
    monkeypatch.setattr(embeddings.settings, "embedding_concurrency", 16)

    def fake_embed_page(_client: object, pdf_bytes: bytes) -> list[float]:
        calls.append(pdf_bytes)
        return [float(pdf_bytes[-1])]

    monkeypatch.setattr(embeddings, "_get_client", lambda: object())
    monkeypatch.setattr(embeddings, "_embed_pdf_page", fake_embed_page)

    vectors = embeddings.embed_pdf_pages([b"page-1", b"page-2", b"page-3"])

    assert set(calls) == {b"page-1", b"page-2", b"page-3"}
    assert vectors == [[49.0], [50.0], [51.0]]


def _write_pdf(path: Path, page_texts: list[str]) -> None:
    doc: object = fitz.open()
    try:
        for text in page_texts:
            page = methodcaller("new_page")(doc)
            methodcaller("insert_text", (72, 72), text)(page)
        methodcaller("save", path)(doc)
    finally:
        methodcaller("close")(doc)


def test_extract_pages_returns_page_text_and_single_page_pdfs(tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    _write_pdf(pdf_path, ["First page text", "Second page text"])

    pages = ingestion.extract_pdf_pages(str(pdf_path))

    assert [page.page_no for page in pages] == [1, 2]
    assert "First page text" in pages[0].text
    assert "Second page text" in pages[1].text
    assert all(page.pdf_bytes.startswith(b"%PDF") for page in pages)


def test_document_text_includes_only_pages_with_text() -> None:
    text = ingestion.document_text(
        [
            ingestion.PagePayload(page_no=1, text="Alpha", pdf_bytes=b""),
            ingestion.PagePayload(page_no=2, text="  ", pdf_bytes=b""),
            ingestion.PagePayload(page_no=3, text="Gamma", pdf_bytes=b""),
        ]
    )

    assert text == "--- Page 1 ---\nAlpha\n\n--- Page 3 ---\nGamma"


class FakeChunkQuery:
    def __init__(self) -> None:
        self.deleted = False

    def filter(self, _criterion: object) -> FakeChunkQuery:
        return self

    def delete(self) -> None:
        self.deleted = True


class FakeSyncSession:
    def __init__(self, document: DbDocument | None) -> None:
        self.document = document
        self.added: list[DocumentChunk] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.query_result = FakeChunkQuery()

    def get(self, model: type[DbDocument], document_id: str) -> DbDocument | None:
        assert model is DbDocument
        if self.document is not None:
            assert self.document.id == document_id
        return self.document

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def query(self, model: type[DocumentChunk]) -> FakeChunkQuery:
        assert model is DocumentChunk
        return self.query_result

    def add(self, chunk: DocumentChunk) -> None:
        self.added.append(chunk)

    def close(self) -> None:
        self.closed = True


def test_process_document_indexes_pages_and_updates_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = DbDocument(id="doc_1", filename="sample.pdf", file_path="/tmp/sample.pdf")
    session = FakeSyncSession(document)
    pages = [
        ingestion.PagePayload(page_no=1, text="Alpha", pdf_bytes=b"pdf-1"),
        ingestion.PagePayload(page_no=2, text="Beta", pdf_bytes=b"pdf-2"),
    ]
    def fake_sync_session() -> FakeSyncSession:
        return session

    def fake_extract_pages(_path: str) -> list[ingestion.PagePayload]:
        return pages

    def fake_embed_pdf_pages(_pdfs: list[bytes]) -> list[list[float]]:
        return [[0.1], [0.2]]

    monkeypatch.setattr(ingestion, "sync_session", fake_sync_session)
    monkeypatch.setattr(ingestion, "extract_pdf_pages", fake_extract_pages)
    monkeypatch.setattr(ingestion, "embed_pdf_pages", fake_embed_pdf_pages)

    ingestion.process_document("doc_1")

    assert document.status == DOCUMENT_STATUS_COMPLETED
    assert document.page_count == 2
    assert document.chunk_count == 2
    assert document.extracted_text == "--- Page 1 ---\nAlpha\n\n--- Page 2 ---\nBeta"
    assert session.query_result.deleted is True
    assert [(chunk.page_no, chunk.content, chunk.embedding) for chunk in session.added] == [
        (1, "Alpha", [0.1]),
        (2, "Beta", [0.2]),
    ]
    assert session.commits == 2
    assert session.closed is True


def test_process_document_records_failure_and_reraises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = DbDocument(id="doc_1", filename="sample.pdf", file_path="/tmp/sample.pdf")
    session = FakeSyncSession(document)
    def fake_sync_session() -> FakeSyncSession:
        return session

    monkeypatch.setattr(ingestion, "sync_session", fake_sync_session)

    def fail_extract(_path: str) -> list[ingestion.PagePayload]:
        raise ValueError("broken pdf")

    monkeypatch.setattr(ingestion, "extract_pdf_pages", fail_extract)

    with pytest.raises(ValueError, match="broken pdf"):
        ingestion.process_document("doc_1")

    assert document.status == DOCUMENT_STATUS_FAILED
    assert document.error == "broken pdf"
    assert session.rollbacks == 1
    assert session.closed is True
    assert session.commits == 2
