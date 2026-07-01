from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from io import BytesIO
from pathlib import Path
from types import TracebackType

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from backend.lib.db.models import DOCUMENT_STATUS_FAILED, DOCUMENT_STATUS_PENDING, Document
from backend.lib.services import document as document_service


class RecordingDocumentSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted_instances: list[object] = []
        self.commits = 0
        self.refreshed: list[object] = []
        self.document_result: Document | None = None
        self.documents_result: list[Document] = []

    def add(self, instance: object, _warn: bool = True) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, instance: object, *args: object, **kwargs: object) -> None:
        self.refreshed.append(instance)
        if isinstance(instance, Document) and not instance.id:
            instance.id = "doc_123"

    async def delete(self, instance: object) -> None:
        self.deleted_instances.append(instance)

    async def execute(self, *args: object, **kwargs: object) -> FakeExecuteResult:
        return FakeExecuteResult(
            document_result=self.document_result,
            documents_result=self.documents_result,
        )


class FakeScalarResult:
    def __init__(self, documents: list[Document]) -> None:
        self._documents = documents

    def all(self) -> list[Document]:
        return self._documents


class FakeExecuteResult:
    def __init__(
        self,
        *,
        document_result: Document | None,
        documents_result: list[Document],
    ) -> None:
        self._document_result = document_result
        self._documents_result = documents_result

    def scalar_one_or_none(self) -> Document | None:
        return self._document_result

    def scalars(self) -> FakeScalarResult:
        return FakeScalarResult(self._documents_result)


class RecordingSessionContext:
    def __init__(self, session: RecordingDocumentSession) -> None:
        self._session = session

    async def __aenter__(self) -> RecordingDocumentSession:
        return self._session

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


def _service(
    session: RecordingDocumentSession,
    *,
    enqueue: document_service.EnqueueIngestion | None = None,
) -> document_service.DocumentService:
    def session_factory() -> AbstractAsyncContextManager[document_service.DocumentSession]:
        return RecordingSessionContext(session)

    def noop_enqueue(_document_id: str) -> None:
        return None

    return document_service.DocumentService(
        session_factory=session_factory,
        enqueue=enqueue or noop_enqueue,
    )


def _upload_file(
    *,
    filename: str | None = "lease.pdf",
    content_type: str = "application/pdf",
    content: bytes = b"%PDF-1.7\n",
) -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


@pytest.mark.parametrize(
    ("raw_filename", "expected"),
    [
        ("../../secret.pdf", "secret.pdf"),
        (" contract ", "contract.pdf"),
        ("...", "document.pdf"),
        ("bad/name\x00.pdf", "name_.pdf"),
        (None, "document.pdf"),
    ],
)
def test_safe_display_filename(raw_filename: str | None, expected: str) -> None:
    assert document_service.safe_display_filename(raw_filename) == expected


def test_safe_display_filename_truncates_while_preserving_pdf_suffix() -> None:
    filename = document_service.safe_display_filename(f"{'a' * 250}.pdf")

    assert len(filename) == document_service.MAX_STORED_FILENAME_LENGTH
    assert filename.endswith(".pdf")


@pytest.mark.asyncio
async def test_list_documents_returns_session_results() -> None:
    documents = [
        Document(id="doc_1", filename="a.pdf", file_path="/tmp/a.pdf"),
        Document(id="doc_2", filename="b.pdf", file_path="/tmp/b.pdf"),
    ]
    session = RecordingDocumentSession()
    session.documents_result = documents

    assert await _service(session).list_documents() == documents


@pytest.mark.asyncio
async def test_upload_document_stores_file_and_enqueues_ingestion(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueued: list[str] = []
    session = RecordingDocumentSession()
    service = _service(session, enqueue=enqueued.append)
    monkeypatch.setattr(document_service.settings, "upload_dir", str(tmp_path))

    document = await service.upload_document(
        _upload_file(filename="../../Tender.pdf", content=b"%PDF payload"),
    )

    assert document.id == "doc_123"
    assert document.filename == "Tender.pdf"
    assert document.status == DOCUMENT_STATUS_PENDING
    assert document.file_path.startswith(str(tmp_path))
    assert Path(document.file_path).read_bytes() == b"%PDF payload"
    assert enqueued == ["doc_123"]
    assert session.added == [document]
    assert session.commits == 1


@pytest.mark.asyncio
async def test_upload_document_marks_document_failed_when_queue_is_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = RecordingDocumentSession()
    monkeypatch.setattr(document_service.settings, "upload_dir", str(tmp_path))

    def fail_enqueue(_document_id: str) -> None:
        raise RuntimeError("redis unavailable")

    service = _service(session, enqueue=fail_enqueue)
    document = await service.upload_document(_upload_file())

    assert document.status == DOCUMENT_STATUS_FAILED
    assert document.error == "Could not enqueue document for processing."
    assert session.commits == 2


@pytest.mark.asyncio
async def test_upload_document_rejects_non_pdf_file() -> None:
    with pytest.raises(ValueError, match="Only PDF files"):
        await _service(RecordingDocumentSession()).upload_document(
            _upload_file(filename="notes.txt", content_type="text/plain"),
        )


@pytest.mark.asyncio
async def test_upload_document_rejects_oversized_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(document_service.settings, "max_upload_size", 3)

    with pytest.raises(ValueError, match="File too large"):
        await _service(RecordingDocumentSession()).upload_document(
            _upload_file(content=b"%PDF"),
        )


@pytest.mark.asyncio
async def test_delete_document_removes_database_record_and_file(
    tmp_path: Path,
) -> None:
    file_path = tmp_path / "stored.pdf"
    file_path.write_bytes(b"pdf")
    stored = Document(id="doc_1", filename="stored.pdf", file_path=str(file_path))
    session = RecordingDocumentSession()
    session.document_result = stored

    deleted = await _service(session).delete_document("doc_1")

    assert deleted is True
    assert session.deleted_instances == [stored]
    assert session.commits == 1
    assert not file_path.exists()


@pytest.mark.asyncio
async def test_delete_document_returns_false_when_document_is_missing() -> None:
    deleted = await _service(RecordingDocumentSession()).delete_document("missing")

    assert deleted is False


@pytest.mark.asyncio
async def test_get_document_file_returns_stored_pdf_metadata(tmp_path: Path) -> None:
    file_path = tmp_path / "stored.pdf"
    file_path.write_bytes(b"pdf")
    session = RecordingDocumentSession()
    session.document_result = Document(
        id="doc_1",
        filename="stored.pdf",
        file_path=str(file_path),
    )

    document_file = await _service(session).get_document_file("doc_1")

    assert document_file == document_service.DocumentFile(
        path=str(file_path),
        filename="stored.pdf",
    )


@pytest.mark.asyncio
async def test_get_document_file_raises_when_stored_file_is_missing() -> None:
    session = RecordingDocumentSession()
    session.document_result = Document(
        id="doc_1",
        filename="missing.pdf",
        file_path="/definitely/not/here.pdf",
    )

    with pytest.raises(document_service.DocumentFileMissingError):
        await _service(session).get_document_file("doc_1")
