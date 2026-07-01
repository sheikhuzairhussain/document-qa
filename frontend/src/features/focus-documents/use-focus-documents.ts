import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useActiveThreadId } from "@/features/chat/active-thread-context";
import {
	focusDocumentsStore,
	persistFocusDocuments,
	readFocusDocuments,
} from "@/features/focus-documents/focus-documents-store";
import { agentsClient } from "@/lib/agents";

export function useFocusDocuments() {
	const activeThreadId = useActiveThreadId();
	const [metadataError, setMetadataError] = useState<string | null>(null);

	useSyncExternalStore(
		focusDocumentsStore.subscribe,
		focusDocumentsStore.getVersion,
	);

	const focusThreadId = activeThreadId ?? focusDocumentsStore.getDraftId();
	const prevActive = useRef<string | null>(activeThreadId);

	useEffect(() => {
		if (activeThreadId !== null && prevActive.current === null) {
			focusDocumentsStore.rotateDraft();
		}
		prevActive.current = activeThreadId;
	}, [activeThreadId]);

	useEffect(() => {
		if (activeThreadId === null) return;
		if (focusDocumentsStore.hasThread(activeThreadId)) return;
		let cancelled = false;
		void (async () => {
			try {
				const thread = await agentsClient.threads.get(activeThreadId);
				if (!cancelled) {
					focusDocumentsStore.mergeDocuments(
						activeThreadId,
						readFocusDocuments(thread),
					);
				}
			} catch {
				// Thread may not exist yet while a new chat is optimistic.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeThreadId]);

	const persistIfReal = useCallback(
		async (threadId: string, docIds: readonly string[]) => {
			if (focusDocumentsStore.isCurrentDraft(threadId)) return;
			try {
				await persistFocusDocuments(threadId, docIds);
				setMetadataError(null);
			} catch (err) {
				console.error("Failed to persist focus documents", err);
				setMetadataError("Failed to save this chat's focus documents.");
			}
		},
		[],
	);

	const addFocusDocument = useCallback(
		async (documentId: string) => {
			const next = focusDocumentsStore.addDocument(focusThreadId, documentId);
			await persistIfReal(focusThreadId, next);
		},
		[focusThreadId, persistIfReal],
	);

	const removeFocusDocument = useCallback(
		async (documentId: string) => {
			const next = focusDocumentsStore.removeDocument(
				focusThreadId,
				documentId,
			);
			await persistIfReal(focusThreadId, next);
		},
		[focusThreadId, persistIfReal],
	);

	const removeFocusDocumentEverywhere = useCallback(
		(documentId: string) => {
			const changedThreads =
				focusDocumentsStore.removeDocumentEverywhere(documentId);
			for (const { threadId, docIds } of changedThreads) {
				void persistIfReal(threadId, docIds);
			}
		},
		[persistIfReal],
	);

	const focusDocumentIdList = focusDocumentsStore.getDocuments(focusThreadId);
	const focusDocumentIds = useMemo(
		() => new Set(focusDocumentIdList),
		[focusDocumentIdList],
	);

	return {
		focusThreadId,
		focusDocumentIds,
		addFocusDocument,
		removeFocusDocument,
		removeFocusDocumentEverywhere,
		error: metadataError,
	};
}
