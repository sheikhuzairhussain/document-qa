import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useActiveThreadId } from "@/components/agent-runtime-provider";
import { useDocuments } from "@/hooks/use-documents";
import { agentsClient } from "@/lib/agents";
import {
	focusDocumentsStore,
	persistFocusDocuments,
	readFocusDocuments,
} from "@/lib/focus-documents";
import type { Document } from "@/types";
import { removeDocumentFromStoredSelections } from "../hooks/use-document-selection";

interface DocumentsContextValue {
	documents: Document[];
	loading: boolean;
	uploading: boolean;
	/** The current conversation id: the Aegra thread id once it exists, or a
	 * client-generated draft id for a not-yet-created conversation. */
	focusThreadId: string;
	/** Ids of documents explicitly marked as focus for the current chat. */
	focusDocumentIds: Set<string>;
	/** Upload a PDF and add it to focus by default. */
	upload: (file: File) => Promise<void>;
	/** Upload a PDF to the document library without adding it to focus. */
	uploadToLibrary: (file: File) => Promise<void>;
	addToFocus: (document: Document) => Promise<void>;
	removeFromFocus: (document: Document) => Promise<void>;
	deleteDocument: (document: Document) => Promise<void>;
	reprocessDocument: (document: Document) => Promise<void>;
	refresh: () => void;
	error: string | null;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

/**
 * Shares the document library + the current chat's focus document set across
 * the workspace. Documents are uploaded into a flat library and marked as focus
 * purely on the frontend (via {@link focusDocumentsStore}); that association is
 * persisted onto the Aegra thread's `focus_documents` metadata when the thread is
 * created (see the thread-list adapter) or updated for an existing thread.
 */
export function DocumentsProvider({ children }: PropsWithChildren) {
	const activeThreadId = useActiveThreadId();
	const {
		documents,
		loading,
		uploading,
		error: documentsError,
		upload: uploadDoc,
		deleteDocument: deleteDoc,
		reprocessDocument: reprocessDoc,
		refresh,
	} = useDocuments();
	const [metadataError, setMetadataError] = useState<string | null>(null);

	// Re-render whenever the focus-documents store changes (draft rotation,
	// attach/detach, metadata hydration).
	const storeVersion = useSyncExternalStore(
		focusDocumentsStore.subscribe,
		focusDocumentsStore.getVersion,
	);

	// The current conversation id: the real thread once it exists, otherwise the draft.
	const focusThreadId = activeThreadId ?? focusDocumentsStore.getDraftId();

	// When a real thread becomes active (draft promoted on first message, or a
	// switch to an existing chat), start a fresh draft so the *next* new chat
	// begins empty. A new-chat state is only ever reached from a real thread, so
	// this keeps each new chat's documents isolated.
	const prevActive = useRef<string | null>(activeThreadId);
	useEffect(() => {
		if (activeThreadId !== null && prevActive.current === null) {
			focusDocumentsStore.rotateDraft();
		}
		prevActive.current = activeThreadId;
	}, [activeThreadId]);

	// When switching to an existing thread we haven't loaded, hydrate its
	// focus_documents from the thread metadata.
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
				// Thread may not exist yet (optimistic new chat); ignore.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeThreadId]);

	// Persist to thread metadata only once the thread actually exists. For a
	// new-chat draft, the ids are flushed to metadata when the thread is created.
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

	const upload = useCallback(
		async (file: File) => {
			const doc = await uploadDoc(file);
			if (!doc) return;
			const next = focusDocumentsStore.addDocument(focusThreadId, doc.id);
			await persistIfReal(focusThreadId, next);
		},
		[uploadDoc, focusThreadId, persistIfReal],
	);

	const uploadToLibrary = useCallback(
		async (file: File) => {
			await uploadDoc(file);
		},
		[uploadDoc],
	);

	const addToFocus = useCallback(
		async (document: Document) => {
			const next = focusDocumentsStore.addDocument(focusThreadId, document.id);
			await persistIfReal(focusThreadId, next);
		},
		[focusThreadId, persistIfReal],
	);

	const removeFromFocus = useCallback(
		async (document: Document) => {
			const next = focusDocumentsStore.removeDocument(
				focusThreadId,
				document.id,
			);
			await persistIfReal(focusThreadId, next);
		},
		[focusThreadId, persistIfReal],
	);

	const deleteDocument = useCallback(
		async (document: Document) => {
			await deleteDoc(document.id);
			const changedThreads = focusDocumentsStore.removeDocumentEverywhere(
				document.id,
			);
			removeDocumentFromStoredSelections(document.id);
			for (const { threadId, docIds } of changedThreads) {
				void persistIfReal(threadId, docIds);
			}
		},
		[deleteDoc, persistIfReal],
	);

	const reprocessDocument = useCallback(
		async (document: Document) => {
			await reprocessDoc(document.id);
		},
		[reprocessDoc],
	);

	// storeVersion is an external-store tick: it re-derives the set on any store
	// mutation even though the callback doesn't reference it directly.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional store-version dep
	const focusDocumentIds = useMemo(
		() => new Set(focusDocumentsStore.getDocuments(focusThreadId)),
		[focusThreadId, storeVersion],
	);

	const value = useMemo<DocumentsContextValue>(
		() => ({
			documents,
			loading,
			uploading,
			focusThreadId,
			focusDocumentIds,
			upload,
			uploadToLibrary,
			addToFocus,
			removeFromFocus,
			deleteDocument,
			reprocessDocument,
			refresh,
			error: documentsError ?? metadataError,
		}),
		[
			documents,
			loading,
			uploading,
			focusThreadId,
			focusDocumentIds,
			upload,
			uploadToLibrary,
			addToFocus,
			removeFromFocus,
			deleteDocument,
			reprocessDocument,
			refresh,
			documentsError,
			metadataError,
		],
	);

	return (
		<DocumentsContext.Provider value={value}>
			{children}
		</DocumentsContext.Provider>
	);
}

export function useDocumentsContext(): DocumentsContextValue {
	const ctx = useContext(DocumentsContext);
	if (!ctx) {
		throw new Error(
			"useDocumentsContext must be used within a DocumentsProvider",
		);
	}
	return ctx;
}
