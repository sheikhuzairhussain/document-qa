from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routers import documents
from backend.lib.services.document import DocumentFile


@dataclass
class DocumentRecord:
    id: str
    filename: str
    page_count: int = 1
    uploaded_at: datetime = datetime(2026, 1, 1, tzinfo=UTC)
    status: str = "completed"
    chunk_count: int = 1
    error: str | None = None
    file_path: str = ""


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(documents.router)
    return TestClient(app)


def test_list_documents_endpoint_returns_serialized_documents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_list_documents() -> list[DocumentRecord]:
        return [DocumentRecord(id="doc_1", filename="lease.pdf")]

    monkeypatch.setattr(documents, "list_documents", fake_list_documents)

    with _client() as client:
        response = client.get("/api/documents")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "doc_1",
            "filename": "lease.pdf",
            "page_count": 1,
            "uploaded_at": "2026-01-01T00:00:00Z",
            "status": "completed",
            "chunk_count": 1,
            "error": None,
        }
    ]


def test_upload_document_endpoint_maps_validation_error_to_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_upload_document(_file: object) -> DocumentRecord:
        raise ValueError("Only PDF files are supported.")

    monkeypatch.setattr(documents, "upload_document", fake_upload_document)

    with _client() as client:
        response = client.post(
            "/api/documents",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "Only PDF files are supported."}


def test_upload_document_endpoint_returns_created_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_upload_document(_file: object) -> DocumentRecord:
        return DocumentRecord(id="doc_2", filename="report.pdf", page_count=3, chunk_count=3)

    monkeypatch.setattr(documents, "upload_document", fake_upload_document)

    with _client() as client:
        response = client.post(
            "/api/documents",
            files={"file": ("report.pdf", b"%PDF", "application/pdf")},
        )

    assert response.status_code == 201
    assert response.json()["id"] == "doc_2"
    assert response.json()["filename"] == "report.pdf"


def test_reprocess_document_endpoint_returns_404_for_missing_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_reprocess_document(_document_id: str) -> DocumentRecord | None:
        return None

    monkeypatch.setattr(documents, "reprocess_document", fake_reprocess_document)

    with _client() as client:
        response = client.post("/api/documents/missing/reprocess")

    assert response.status_code == 404
    assert response.json() == {"detail": "Document not found"}


def test_delete_document_endpoint_returns_204_when_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_delete_document(document_id: str) -> bool:
        assert document_id == "doc_1"
        return True

    monkeypatch.setattr(documents, "delete_document", fake_delete_document)

    with _client() as client:
        response = client.delete("/api/documents/doc_1")

    assert response.status_code == 204
    assert response.content == b""


def test_delete_document_endpoint_returns_404_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_delete_document(_document_id: str) -> bool:
        return False

    monkeypatch.setattr(documents, "delete_document", fake_delete_document)

    with _client() as client:
        response = client.delete("/api/documents/missing")

    assert response.status_code == 404
    assert response.json() == {"detail": "Document not found"}


def test_serve_document_file_returns_pdf_bytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_path = tmp_path / "lease.pdf"
    file_path.write_bytes(b"%PDF data")

    async def fake_get_document_file(document_id: str) -> DocumentFile | None:
        assert document_id == "doc_1"
        return DocumentFile(path=str(file_path), filename="lease.pdf")

    monkeypatch.setattr(documents, "get_document_file", fake_get_document_file)

    with _client() as client:
        response = client.get("/api/documents/doc_1/content")

    assert response.status_code == 200
    assert response.content == b"%PDF data"
    assert response.headers["content-type"] == "application/pdf"


def test_serve_document_file_returns_404_when_file_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get_document_file(_document_id: str) -> DocumentFile | None:
        raise documents.DocumentFileMissingError("/definitely/not/here.pdf")

    monkeypatch.setattr(documents, "get_document_file", fake_get_document_file)

    with _client() as client:
        response = client.get("/api/documents/doc_1/content")

    assert response.status_code == 404
    assert response.json() == {"detail": "File not found on disk"}
