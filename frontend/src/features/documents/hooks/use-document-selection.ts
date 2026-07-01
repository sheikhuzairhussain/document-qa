import { useCallback, useEffect, useState } from "react";
import type { AvailableDocuments, DocSelection } from "@/types";

const DEFAULT_SELECTION: DocSelection = { library: [] };

// --------------------------------------------------------------------------- //
// Persistence layer (isolated on purpose)
//
// Today this is localStorage keyed by conversation id. The planned follow-up is
// to persist availability on the conversation record; when that lands, only
// these two functions change.
// --------------------------------------------------------------------------- //

const STORAGE_PREFIX = "docavailable:selection:";

function storageKey(conversationId: string): string {
	return `${STORAGE_PREFIX}${conversationId}`;
}

function isAvailableDocuments(value: unknown): value is AvailableDocuments {
	return (
		value === "all" ||
		(Array.isArray(value) && value.every((item) => typeof item === "string"))
	);
}

function loadSelection(conversationId: string | null): DocSelection {
	if (!conversationId) return DEFAULT_SELECTION;
	try {
		const raw = localStorage.getItem(storageKey(conversationId));
		if (!raw) return DEFAULT_SELECTION;
		const parsed = JSON.parse(raw) as Partial<DocSelection>;
		if (!isAvailableDocuments(parsed.library)) return DEFAULT_SELECTION;
		return { library: parsed.library };
	} catch {
		return DEFAULT_SELECTION;
	}
}

function saveSelection(conversationId: string, selection: DocSelection): void {
	try {
		localStorage.setItem(storageKey(conversationId), JSON.stringify(selection));
	} catch {
		// Ignore storage failures (private mode, quota exceeded, etc.)
	}
}

function removeId(
	section: AvailableDocuments,
	documentId: string,
): AvailableDocuments {
	return section === "all" ? "all" : section.filter((id) => id !== documentId);
}

function removeFromSelection(
	selection: DocSelection,
	documentId: string,
): DocSelection {
	return {
		library: removeId(selection.library, documentId),
	};
}

export function removeDocumentFromStoredSelections(documentId: string): void {
	try {
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (!key?.startsWith(STORAGE_PREFIX)) continue;
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			const parsed = JSON.parse(raw) as Partial<DocSelection>;
			if (!isAvailableDocuments(parsed.library)) continue;
			const next = removeFromSelection({ library: parsed.library }, documentId);
			localStorage.setItem(key, JSON.stringify(next));
		}
	} catch {
		// Ignore storage failures (private mode, quota exceeded, etc.)
	}
}

// --------------------------------------------------------------------------- //
// Hook
// --------------------------------------------------------------------------- //

/**
 * Owns which documents are exposed to the assistant for a conversation.
 *
 * Semantics:
 * - Focus documents are always available and are not controlled here.
 * - Library `all` mode means every document, current and future, is available.
 * - Otherwise, the explicit id list is the library availability filter.
 */
export function useDocumentSelection(conversationId: string | null) {
	const [selection, setSelection] = useState<DocSelection>(() =>
		loadSelection(conversationId),
	);

	// Reload when switching conversations.
	useEffect(() => {
		setSelection(loadSelection(conversationId));
	}, [conversationId]);

	// Persist synchronously alongside every mutation so there's no stale-effect
	// window on conversation switch.
	const commit = useCallback(
		(next: DocSelection) => {
			setSelection(next);
			if (conversationId) saveSelection(conversationId, next);
		},
		[conversationId],
	);

	const libraryAll = selection.library === "all";
	const librarySelected = new Set(
		selection.library === "all" ? [] : selection.library,
	);

	const toggleLibraryAll = useCallback(() => {
		commit({ ...selection, library: libraryAll ? [] : "all" });
	}, [commit, selection, libraryAll]);

	const toggleLibraryDoc = useCallback(
		(id: string) => {
			if (selection.library === "all") return;
			const set = new Set(selection.library);
			if (set.has(id)) {
				set.delete(id);
			} else {
				set.add(id);
			}
			commit({ ...selection, library: [...set] });
		},
		[commit, selection],
	);

	const removeDoc = useCallback(
		(documentId: string) => {
			commit(removeFromSelection(selection, documentId));
		},
		[commit, selection],
	);

	return {
		selection,
		libraryAll,
		librarySelected,
		toggleLibraryAll,
		toggleLibraryDoc,
		removeDoc,
	};
}

export type DocumentSelection = ReturnType<typeof useDocumentSelection>;
