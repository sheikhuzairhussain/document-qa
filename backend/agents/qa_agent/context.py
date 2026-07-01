"""Runtime context shared between the chat UI and the qa-agent."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypedDict, TypeGuard

FOCUS_DOCUMENTS_KEY = "focus_documents"
AVAILABLE_DOCUMENTS_KEY = "available_documents"
SELECT_ALL_DOCUMENTS: Literal["all"] = "all"

type AvailableDocuments = Literal["all"] | list[str]


class AgentContext(TypedDict, total=False):
    """Hidden per-run context supplied by the frontend."""

    focus_documents: list[str]
    available_documents: AvailableDocuments


def _string_list(value: object) -> list[str]:
    if not _is_object_list(value):
        return []

    return [doc_id for doc_id in value if isinstance(doc_id, str) and doc_id]


def _is_object_list(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def _is_context_mapping(value: object) -> TypeGuard[Mapping[str, object]]:
    return isinstance(value, Mapping)


def get_focus_document_ids(context: object) -> list[str] | None:
    """Return focus document ids, preserving missing vs empty context."""
    if not _is_context_mapping(context) or FOCUS_DOCUMENTS_KEY not in context:
        return None

    return _string_list(context[FOCUS_DOCUMENTS_KEY])


def get_available_documents(context: object) -> AvailableDocuments | None:
    """Return the retrieval allow-list, preserving missing vs empty context.

    ``"all"`` means no document-id SQL filter. A list is an explicit allow-list.
    Invalid supplied values fail closed as an empty allow-list.
    """
    if not _is_context_mapping(context) or AVAILABLE_DOCUMENTS_KEY not in context:
        return None

    value = context[AVAILABLE_DOCUMENTS_KEY]
    if value == SELECT_ALL_DOCUMENTS:
        return SELECT_ALL_DOCUMENTS

    return _string_list(value)
