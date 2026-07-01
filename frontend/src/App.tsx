import { FileText, FolderOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	ActiveThreadProvider,
	AgentRuntimeProvider,
} from "@/components/agent-runtime-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { DocumentPanel } from "@/components/document-panel";
import {
	DocumentsProvider,
	useDocumentsContext,
} from "@/components/documents-context";
import { PdfViewerProvider } from "@/components/pdf-viewer";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentSelection } from "@/hooks/use-document-selection";
import { resolveAvailableDocuments } from "@/lib/available-documents";
import { getPdfFiles } from "@/lib/files";
import { cn } from "@/lib/utils";

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_DEFAULT_WIDTH = 300;

function getInitialSidebarWidth() {
	if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
	const stored = Number(window.localStorage.getItem("sidebar_width"));
	return stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH
		? stored
		: SIDEBAR_DEFAULT_WIDTH;
}

function hasFileDrag(dataTransfer: DataTransfer): boolean {
	return Array.from(dataTransfer.types).includes("Files");
}

type DocumentDropIntent = "focus" | "library";

function documentDropIntentFromTarget(
	target: EventTarget | null,
): DocumentDropIntent | null {
	if (!(target instanceof Element)) return null;
	const dropTarget = target.closest<HTMLElement>("[data-document-drop-intent]");
	const intent = dropTarget?.dataset.documentDropIntent;
	return intent === "focus" || intent === "library" ? intent : null;
}

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

	const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
	const [isResizing, setIsResizing] = useState(false);
	const [pageDragDepth, setPageDragDepth] = useState(0);
	const [pageDropIntent, setPageDropIntent] =
		useState<DocumentDropIntent | null>(null);
	const isPageDragging = pageDragDepth > 0;

	const handlePageDragEnter = useCallback((e: React.DragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		setPageDragDepth(1);
	}, []);

	const handlePageDragOver = useCallback((e: React.DragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		setPageDropIntent(documentDropIntentFromTarget(e.target));
	}, []);

	const handlePageDragLeave = useCallback((e: React.DragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		const nextTarget = e.relatedTarget;
		if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
			return;
		}
		setPageDragDepth(0);
		setPageDropIntent(null);
	}, []);

	const handlePageDrop = useCallback(
		(e: React.DragEvent) => {
			if (!hasFileDrag(e.dataTransfer)) return;
			e.preventDefault();
			e.stopPropagation();
			setPageDragDepth(0);
			setPageDropIntent(null);

			const files = getPdfFiles(e.dataTransfer.files);
			if (files.length === 0) return;

			const intent = documentDropIntentFromTarget(e.target) ?? "focus";
			const uploadTarget =
				intent === "library" ? handleLibraryUpload : handleUpload;
			for (const file of files) {
				void uploadTarget(file);
			}
		},
		[handleUpload, handleLibraryUpload],
	);

	const handleResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsResizing(true);
			const startX = e.clientX;
			const startWidth = sidebarWidth;
			window.document.body.style.cursor = "col-resize";
			window.document.body.style.userSelect = "none";

			const handleMove = (moveEvent: MouseEvent) => {
				const next = Math.min(
					SIDEBAR_MAX_WIDTH,
					Math.max(SIDEBAR_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
				);
				setSidebarWidth(next);
			};

			const handleUp = () => {
				setIsResizing(false);
				window.document.body.style.cursor = "";
				window.document.body.style.userSelect = "";
				window.removeEventListener("mousemove", handleMove);
				window.removeEventListener("mouseup", handleUp);
				setSidebarWidth((w) => {
					window.localStorage.setItem("sidebar_width", String(w));
					return w;
				});
			};

			window.addEventListener("mousemove", handleMove);
			window.addEventListener("mouseup", handleUp);
		},
		[sidebarWidth],
	);

	return (
		<AgentRuntimeProvider availableDocuments={availableDocuments}>
			<PdfViewerProvider>
				<SidebarProvider
					style={
						{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
					}
					className={cn(
						"relative",
						isResizing &&
							"[&_[data-slot=sidebar-gap]]:transition-none [&_[data-slot=sidebar-container]]:transition-none",
					)}
					onDragEnterCapture={handlePageDragEnter}
					onDragOverCapture={handlePageDragOver}
					onDragLeaveCapture={handlePageDragLeave}
					onDropCapture={handlePageDrop}
				>
					{isPageDragging && (
						<div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-6 backdrop-blur-[2px]">
							<div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
								<DocumentDropTarget
									intent="focus"
									active={pageDropIntent === "focus" || pageDropIntent === null}
									icon={<FileText className="size-5" />}
									title="Add to focus documents"
									description="Pin PDFs to this chat so the agent gives them extra attention"
								/>
								<DocumentDropTarget
									intent="library"
									active={pageDropIntent === "library"}
									icon={<FolderOpen className="size-5" />}
									title="Add to library"
									description="Store PDFs across chats without making them focus documents"
								/>
							</div>
						</div>
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

function DocumentDropTarget({
	intent,
	active,
	icon,
	title,
	description,
}: {
	intent: DocumentDropIntent;
	active: boolean;
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div
			data-document-drop-intent={intent}
			className={cn(
				"flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed bg-white px-5 py-6 text-center shadow-sm transition-colors",
				active
					? "border-neutral-500 bg-neutral-50 text-neutral-900"
					: "border-neutral-200 text-neutral-600",
			)}
		>
			<div
				className={cn(
					"mb-3 flex size-10 items-center justify-center rounded-lg border",
					active
						? "border-neutral-300 bg-white text-neutral-800"
						: "border-neutral-200 bg-neutral-50 text-neutral-400",
				)}
			>
				{icon}
			</div>
			<p className="text-sm font-medium">{title}</p>
			<p className="mt-1 text-xs text-neutral-500">{description}</p>
		</div>
	);
}
