"""Runtime context shared between the chat UI and the qa-agent."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypedDict, cast

FOCUS_DOCUMENTS_KEY = "focus_documents"
AVAILABLE_DOCUMENTS_KEY = "available_documents"
SELECT_ALL_DOCUMENTS: Literal["all"] = "all"

type AvailableDocuments = Literal["all"] | list[str]


class AgentContext(TypedDict, total=False):
    """Hidden per-run context supplied by the frontend."""

    focus_documents: list[str]
    available_documents: AvailableDocuments


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    items = cast("list[object]", value)
    return [doc_id for doc_id in items if isinstance(doc_id, str) and doc_id]


def get_focus_document_ids(context: object) -> list[str] | None:
    """Return focus document ids, preserving missing vs empty context."""
    if not isinstance(context, Mapping) or FOCUS_DOCUMENTS_KEY not in context:
        return None

    mapping = cast("Mapping[str, object]", context)
    return _string_list(mapping[FOCUS_DOCUMENTS_KEY])


def get_available_documents(context: object) -> AvailableDocuments | None:
    """Return the retrieval allow-list, preserving missing vs empty context.

    ``"all"`` means no document-id SQL filter. A list is an explicit allow-list.
    Invalid supplied values fail closed as an empty allow-list.
    """
    if not isinstance(context, Mapping) or AVAILABLE_DOCUMENTS_KEY not in context:
        return None

    mapping = cast("Mapping[str, object]", context)
    value: object = mapping[AVAILABLE_DOCUMENTS_KEY]
    if value == SELECT_ALL_DOCUMENTS:
        return SELECT_ALL_DOCUMENTS

    return _string_list(value)
