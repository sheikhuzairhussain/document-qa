import { useCallback } from "react";
import type { DocumentSelection } from "@/features/documents/hooks/use-document-selection";
import { usePdfUploadDropzone } from "@/features/documents/hooks/use-pdf-upload-dropzone";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";
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
	const { openDocument } = usePdfViewer();
	const { width, dragging, handleMouseDown } = useResizableDocumentPanel();
	const focusUpload = usePdfUploadDropzone({
		disabled: uploading,
		onUpload,
	});
	const libraryUpload = usePdfUploadDropzone({
		disabled: uploading,
		onUpload: onUploadToLibrary,
	});

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
					{...focusUpload.getInputProps({
						"aria-label": "Upload to focus documents",
						className: "hidden",
					})}
				/>
				<input
					{...libraryUpload.getInputProps({
						"aria-label": "Upload to library documents",
						className: "hidden",
					})}
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
							onClick={focusUpload.open}
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
							onClick={libraryUpload.open}
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
