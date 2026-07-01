import { type ChangeEvent, useCallback, useRef } from "react";
import type { DocumentSelection } from "@/features/documents/hooks/use-document-selection";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";
import { getPdfFiles } from "@/lib/files";
import type { Document } from "@/types";
import { DocumentSection } from "./document-section";
import { SectionUploadButton } from "./section-upload-button";
import { useResizableDocumentPanel } from "./use-resizable-document-panel";

interface DocumentPanelProps {
	/** Documents explicitly marked as focus for the current chat. */
	focusDocuments: Document[];
	/** Every other document in the library. */
	libraryDocuments: Document[];
	loading: boolean;
	uploading: boolean;
	error?: string | null;
	selection: DocumentSelection;
	onUpload: (file: File) => void | Promise<void>;
	onUploadToLibrary: (file: File) => void | Promise<void>;
	onAddToFocus: (document: Document) => Promise<void>;
	onRemoveFromFocus: (document: Document) => Promise<void>;
	onDeleteDocument: (document: Document) => Promise<void>;
	onReprocessDocument: (document: Document) => Promise<void>;
}

export function DocumentPanel({
	focusDocuments,
	libraryDocuments,
	loading,
	uploading,
	error,
	selection,
	onUpload,
	onUploadToLibrary,
	onAddToFocus,
	onRemoveFromFocus,
	onDeleteDocument,
	onReprocessDocument,
}: DocumentPanelProps) {
	const focusUploadRef = useRef<HTMLInputElement>(null);
	const libraryUploadRef = useRef<HTMLInputElement>(null);
	const { openDocument } = usePdfViewer();
	const { width, dragging, handleMouseDown } = useResizableDocumentPanel();

	const { libraryAll, librarySelected, toggleLibraryAll, toggleLibraryDoc } =
		selection;

	const handleDelete = useCallback(
		async (doc: Document) => {
			try {
				await onDeleteDocument(doc);
				selection.removeDoc(doc.id);
			} catch (err) {
				console.error("Failed to delete document", err);
			}
		},
		[onDeleteDocument, selection],
	);

	const handleReprocess = useCallback(
		async (doc: Document) => {
			try {
				await onReprocessDocument(doc);
			} catch (err) {
				console.error("Failed to reprocess document", err);
			}
		},
		[onReprocessDocument],
	);

	const handleAddToFocus = useCallback(
		async (doc: Document) => {
			try {
				await onAddToFocus(doc);
			} catch (err) {
				console.error("Failed to add document to focus", err);
			}
		},
		[onAddToFocus],
	);

	const handleRemoveFromFocus = useCallback(
		async (doc: Document) => {
			try {
				await onRemoveFromFocus(doc);
			} catch (err) {
				console.error("Failed to remove document from focus", err);
			}
		},
		[onRemoveFromFocus],
	);

	const handlePreview = useCallback(
		(doc: Document) => {
			openDocument({
				documentId: doc.id,
				filename: doc.filename,
			});
		},
		[openDocument],
	);

	const handleFocusUploadChange = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			for (const file of getPdfFiles(e.target.files)) {
				void onUpload(file);
			}
			e.target.value = "";
		},
		[onUpload],
	);

	const handleLibraryUploadChange = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			for (const file of getPdfFiles(e.target.files)) {
				void onUploadToLibrary(file);
			}
			e.target.value = "";
		},
		[onUploadToLibrary],
	);

	return (
		<div
			style={{ width }}
			className="relative flex h-full flex-shrink-0 flex-col border-l border-neutral-200 bg-white"
		>
			<button
				type="button"
				aria-label="Resize document panel"
				className={`absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-neutral-300 ${
					dragging ? "bg-neutral-400" : ""
				}`}
				onMouseDown={handleMouseDown}
			/>

			{/* Body */}
			<div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
				<input
					ref={focusUploadRef}
					type="file"
					accept=".pdf,application/pdf"
					multiple
					className="hidden"
					onChange={handleFocusUploadChange}
				/>
				<input
					ref={libraryUploadRef}
					type="file"
					accept=".pdf,application/pdf"
					multiple
					className="hidden"
					onChange={handleLibraryUploadChange}
				/>
				{error && <p className="px-2 text-xs text-destructive">{error}</p>}

				<DocumentSection
					title="Focus documents"
					description="The agent gives these extra attention."
					documents={focusDocuments}
					focus
					action={
						<SectionUploadButton
							uploading={uploading}
							ariaLabel="Upload to focus documents"
							onClick={() => focusUploadRef.current?.click()}
						/>
					}
					onPreview={handlePreview}
					onDelete={handleDelete}
					onReprocess={handleReprocess}
					onRemoveFromFocus={handleRemoveFromFocus}
					emptyHint="No focus documents yet. Upload PDFs here to pin them to this chat."
					loading={loading}
				/>

				<div className="-mx-3 border-t border-neutral-100" />

				<DocumentSection
					title="Other included documents"
					description="All selected documents are available to the agent."
					documents={libraryDocuments}
					allSelected={libraryAll}
					selectedIds={librarySelected}
					action={
						<SectionUploadButton
							uploading={uploading}
							ariaLabel="Upload to library documents"
							onClick={() => libraryUploadRef.current?.click()}
						/>
					}
					onToggleAll={toggleLibraryAll}
					onToggleDoc={toggleLibraryDoc}
					onPreview={handlePreview}
					onDelete={handleDelete}
					onReprocess={handleReprocess}
					onAddToFocus={handleAddToFocus}
					emptyHint="No other library documents yet. Upload PDFs here to store them without pinning."
					loading={loading}
				/>
			</div>
		</div>
	);
}
