from __future__ import annotations

import pytest
from google.genai import types

from backend.lib.services import retrieval


def test_embedding_values_normalizes_and_validates_dimensions() -> None:
    response = types.EmbedContentResponse(
        embeddings=[types.ContentEmbedding(values=[3.0, 4.0])]
    )

    values = retrieval.embedding_values(
        response,
        retrieval.EmbeddingSettings(model="embedding-model", dimensions=2),
    )

    assert values == [0.6, 0.8]


def test_embedding_values_rejects_wrong_dimensions() -> None:
    response = types.EmbedContentResponse(
        embeddings=[types.ContentEmbedding(values=[1.0])]
    )

    with pytest.raises(RuntimeError, match="expected 2"):
        retrieval.embedding_values(
            response,
            retrieval.EmbeddingSettings(model="embedding-model", dimensions=2),
        )


def test_database_url_requires_rag_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval.settings, "rag_database_url", None)

    with pytest.raises(RuntimeError, match="RAG_DATABASE_URL"):
        retrieval.database_url()


class FakeCursor:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.executed_sql: str | None = None
        self.executed_params: dict[str, object] | None = None

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: dict[str, object]) -> None:
        self.executed_sql = sql
        self.executed_params = params

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor


def test_hybrid_search_maps_rows_and_applies_document_filter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cursor = FakeCursor(
        [
            {
                "id": "chunk_1",
                "document_id": "doc_1",
                "filename": "lease.pdf",
                "chunk_index": 0,
                "content": "Rent is £1,000.",
                "page_no": 7,
                "headings": "Rent",
                "rrf_score": 0.42,
            }
        ]
    )
    def fake_embed_query(_query: str) -> str:
        return "[0.1,0.2]"

    def fake_database_url() -> str:
        return "postgresql://example"

    def fake_connect(*_args: object, **_kwargs: object) -> FakeConnection:
        return FakeConnection(cursor)

    monkeypatch.setattr(retrieval, "_embed_query", fake_embed_query)
    monkeypatch.setattr(retrieval, "database_url", fake_database_url)
    monkeypatch.setattr(
        retrieval.Connection,
        "connect",
        fake_connect,
    )

    chunks = retrieval.hybrid_search(
        "rent",
        document_ids=["doc_1"],
        limit=3,
        candidates=5,
    )

    assert cursor.executed_params == {
        "query": "rent",
        "qvec": "[0.1,0.2]",
        "doc_ids": ["doc_1"],
        "candidates": 5,
        "k": retrieval.RRF_K,
        "limit": 3,
    }
    assert chunks == [
        retrieval.RetrievedChunk(
            chunk_id="chunk_1",
            document_id="doc_1",
            filename="lease.pdf",
            chunk_index=0,
            content="Rent is £1,000.",
            page_no=7,
            headings="Rent",
            score=0.42,
        )
    ]


def test_get_documents_preserves_requested_order(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = FakeCursor(
        [
            {
                "id": "doc_b",
                "filename": "b.pdf",
                "status": "completed",
                "page_count": 2,
                "chunk_count": 2,
            },
            {
                "id": "doc_a",
                "filename": "a.pdf",
                "status": "pending",
                "page_count": 0,
                "chunk_count": 0,
            },
        ]
    )
    def fake_database_url() -> str:
        return "postgresql://example"

    def fake_connect(*_args: object, **_kwargs: object) -> FakeConnection:
        return FakeConnection(cursor)

    monkeypatch.setattr(retrieval, "database_url", fake_database_url)
    monkeypatch.setattr(
        retrieval.Connection,
        "connect",
        fake_connect,
    )

    documents = retrieval.get_documents(["doc_b", "doc_a"])

    assert cursor.executed_params == {"doc_ids": ["doc_b", "doc_a"]}
    assert documents == [
        retrieval.DocumentInfo(
            document_id="doc_b",
            filename="b.pdf",
            status="completed",
            page_count=2,
            chunk_count=2,
        ),
        retrieval.DocumentInfo(
            document_id="doc_a",
            filename="a.pdf",
            status="pending",
            page_count=0,
            chunk_count=0,
        ),
    ]


def test_get_documents_short_circuits_empty_input() -> None:
    assert retrieval.get_documents([]) == []
