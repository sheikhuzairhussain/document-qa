import { type CSSProperties, useCallback, useMemo } from "react";
import { DocumentDropOverlay } from "@/app/document-drop-overlay";
import { usePageDocumentDrop } from "@/app/use-page-document-drop";
import { useResizableSidebar } from "@/app/use-resizable-sidebar";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveThreadProvider } from "@/features/chat/active-thread-context";
import { AgentRuntimeProvider } from "@/features/chat/agent-runtime-provider";
import { Thread } from "@/features/chat/components/thread";
import { ThreadSidebar } from "@/features/chat/components/thread-sidebar";
import { resolveAvailableDocuments } from "@/features/documents/available-documents";
import { DocumentPanel } from "@/features/documents/components/document-panel";
import {
	DocumentsProvider,
	useDocumentsContext,
} from "@/features/documents/documents-provider";
import { useDocumentSelection } from "@/features/documents/hooks/use-document-selection";
import { PdfViewerProvider } from "@/features/pdf/pdf-viewer-provider";
import { cn } from "@/lib/utils";

export default function App() {
	return (
		<TooltipProvider delayDuration={200}>
			<ActiveThreadProvider>
				<DocumentsProvider>
					<Workspace />
				</DocumentsProvider>
			</ActiveThreadProvider>
		</TooltipProvider>
	);
}

function Workspace() {
	// The active chat has a frontend-generated id (a draft id until its Aegra
	// thread is created on the first message). Focus documents are associated
	// with it on the frontend and persisted to `focus_documents` metadata.
	const {
		documents,
		loading: documentsLoading,
		uploading,
		error: documentsError,
		upload,
		uploadToLibrary,
		deleteDocument,
		reprocessDocument,
		addToFocus,
		removeFromFocus,
		focusThreadId,
		focusDocumentIds,
	} = useDocumentsContext();

	const selection = useDocumentSelection(focusThreadId);

	const focusDocuments = documents.filter((d) => focusDocumentIds.has(d.id));
	const libraryDocuments = documents.filter((d) => !focusDocumentIds.has(d.id));
	const availableDocuments = useMemo(
		() =>
			resolveAvailableDocuments({
				documents,
				focusDocumentIds,
				librarySelection: selection.selection.library,
			}),
		[documents, focusDocumentIds, selection.selection],
	);

	const handleUpload = useCallback(
		async (file: File) => {
			await upload(file);
		},
		[upload],
	);

	const handleLibraryUpload = useCallback(
		async (file: File) => {
			await uploadToLibrary(file);
		},
		[uploadToLibrary],
	);

	const { sidebarWidth, isResizing, handleResizeStart } = useResizableSidebar();
	const pageDrop = usePageDocumentDrop({
		onUpload: handleUpload,
		onUploadToLibrary: handleLibraryUpload,
	});

	return (
		<AgentRuntimeProvider availableDocuments={availableDocuments}>
			<PdfViewerProvider>
				<SidebarProvider
					style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
					className={cn(
						"relative",
						isResizing &&
							"[&_[data-slot=sidebar-gap]]:transition-none [&_[data-slot=sidebar-container]]:transition-none",
					)}
					{...pageDrop.dragHandlers}
				>
					{pageDrop.isDragging && (
						<DocumentDropOverlay activeIntent={pageDrop.activeIntent} />
					)}
					<ThreadSidebar
						onResizeStart={handleResizeStart}
						isResizing={isResizing}
					/>

					<SidebarInset className="h-screen min-h-0 overflow-hidden">
						<header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3">
							<SidebarTrigger className="-ml-1" />
							<Separator orientation="vertical" />
							<h1 className="truncate text-sm font-medium text-neutral-700">
								Document Q&amp;A
							</h1>
						</header>

						<div className="flex min-h-0 flex-1">
							<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
								<Thread />
							</main>

							<DocumentPanel
								focusDocuments={focusDocuments}
								libraryDocuments={libraryDocuments}
								loading={documentsLoading}
								uploading={uploading}
								error={documentsError}
								selection={selection}
								onUpload={handleUpload}
								onUploadToLibrary={handleLibraryUpload}
								onAddToFocus={addToFocus}
								onRemoveFromFocus={removeFromFocus}
								onDeleteDocument={deleteDocument}
								onReprocessDocument={reprocessDocument}
							/>
						</div>
					</SidebarInset>
				</SidebarProvider>
			</PdfViewerProvider>
		</AgentRuntimeProvider>
	);
}
