from __future__ import annotations

import pytest

from backend.worker import jobs


def test_process_document_delegates_to_ingestion_service(monkeypatch: pytest.MonkeyPatch) -> None:
    processed_document_ids: list[str] = []

    def fake_process_document(document_id: str) -> None:
        processed_document_ids.append(document_id)

    monkeypatch.setattr(jobs, "process_document_ingestion", fake_process_document)

    jobs.process_document("doc_123")

    assert processed_document_ids == ["doc_123"]
