import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { removeDocumentFromStoredSelections } from "@/features/documents/hooks/use-document-selection";
import { useDocuments } from "@/features/documents/hooks/use-documents";
import { useFocusDocuments } from "@/features/focus-documents/use-focus-documents";
import type { Document } from "@/types";

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
	const {
		focusThreadId,
		focusDocumentIds,
		addFocusDocument,
		removeFocusDocument,
		removeFocusDocumentEverywhere,
		error: focusError,
	} = useFocusDocuments();

	const upload = useCallback(
		async (file: File) => {
			const doc = await uploadDoc(file);
			if (!doc) return;
			await addFocusDocument(doc.id);
		},
		[uploadDoc, addFocusDocument],
	);

	const uploadToLibrary = useCallback(
		async (file: File) => {
			await uploadDoc(file);
		},
		[uploadDoc],
	);

	const addToFocus = useCallback(
		async (document: Document) => {
			await addFocusDocument(document.id);
		},
		[addFocusDocument],
	);

	const removeFromFocus = useCallback(
		async (document: Document) => {
			await removeFocusDocument(document.id);
		},
		[removeFocusDocument],
	);

	const deleteDocument = useCallback(
		async (document: Document) => {
			await deleteDoc(document.id);
			removeFocusDocumentEverywhere(document.id);
			removeDocumentFromStoredSelections(document.id);
		},
		[deleteDoc, removeFocusDocumentEverywhere],
	);

	const reprocessDocument = useCallback(
		async (document: Document) => {
			await reprocessDoc(document.id);
		},
		[reprocessDoc],
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
			error: documentsError ?? focusError,
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
			focusError,
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
