import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	FileText,
	Loader2,
	Move,
	RotateCcw,
	Search,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Page, Document as PDFDocument, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "@/lib/api";
import {
	buildFindTargets,
	buildHighlightTarget,
	type HighlightOverlay,
	measureHighlightOverlays,
	renderTextItem,
	type TextLayerHighlightTarget,
} from "@/lib/pdf-highlighting";
import type { PdfViewerRequest } from "./pdf-viewer";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

function useElementWidth<T extends HTMLElement>() {
	const observerRef = useRef<ResizeObserver | null>(null);
	const [width, setWidth] = useState(0);

	const ref = useCallback((element: T | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;

		if (!element) {
			setWidth(0);
			return;
		}

		setWidth(element.getBoundingClientRect().width);
		const observer = new ResizeObserver(([entry]) => {
			setWidth(
				entry?.contentRect.width ?? element.getBoundingClientRect().width,
			);
		});
		observer.observe(element);
		observerRef.current = observer;
	}, []);

	useEffect(() => {
		return () => observerRef.current?.disconnect();
	}, []);

	return [ref, width] as const;
}

export default function PdfViewerDialog({
	request,
	onOpenChange,
}: {
	request: PdfViewerRequest;
	onOpenChange: (request: PdfViewerRequest | null) => void;
}) {
	const [numPages, setNumPages] = useState(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [pdfError, setPdfError] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1);
	const [isPanning, setIsPanning] = useState(false);
	const [highlightTarget, setHighlightTarget] =
		useState<TextLayerHighlightTarget | null>(null);
	const [findQuery, setFindQuery] = useState("");
	const [findTargets, setFindTargets] = useState<TextLayerHighlightTarget[]>(
		[],
	);
	const [activeFindIndex, setActiveFindIndex] = useState(0);
	const [highlightRects, setHighlightRects] = useState<HighlightOverlay[]>([]);
	const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>();
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const pageFrameRef = useRef<HTMLDivElement | null>(null);
	const pageTextContentRef = useRef<unknown>(null);
	const panRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		scrollLeft: number;
		scrollTop: number;
	} | null>(null);
	const setViewportElement = useCallback(
		(element: HTMLDivElement | null) => {
			viewportRef(element);
			scrollRef.current = element;
		},
		[viewportRef],
	);

	const requestedDocumentId = request.documentId;
	const requestedPage = request.pageNo ?? 1;
	useEffect(() => {
		setCurrentPage(Math.max(1, requestedPage));
		scrollRef.current?.scrollTo({ top: 0, left: 0 });
	}, [requestedPage]);

	useEffect(() => {
		if (!requestedDocumentId) return;
		setZoom(1);
		setPdfError(null);
		setFindQuery("");
		setFindTargets([]);
		setActiveFindIndex(0);
		pageTextContentRef.current = null;
	}, [requestedDocumentId]);

	const availablePageWidth = viewportWidth > 0 ? viewportWidth - 48 : 820;
	const basePageWidth = Math.max(280, Math.min(availablePageWidth, 820));
	const pageRenderWidth = Math.round(basePageWidth * zoom);
	const highlightText = request.highlightText?.trim() ?? "";
	const highlightPage = request.citation?.page_no ?? request.pageNo ?? null;
	const hasFindQuery = findQuery.trim().length > 0;
	const activeHighlightText =
		!hasFindQuery && highlightPage !== null && currentPage === highlightPage
			? highlightText
			: "";
	const highlightKey = `${requestedDocumentId}:${currentPage}:${activeHighlightText}`;
	const pageResetKey = `${requestedDocumentId}:${currentPage}`;
	const zoomLabel = `${Math.round(zoom * 100)}%`;
	const findMatchCount = findTargets.length;
	const activeFindOrdinal = findMatchCount === 0 ? 0 : activeFindIndex + 1;

	useEffect(() => {
		if (highlightKey === "") return;
		setHighlightTarget(null);
		setHighlightRects([]);
	}, [highlightKey]);

	useEffect(() => {
		if (!pageResetKey) return;
		pageTextContentRef.current = null;
		setFindTargets([]);
		setActiveFindIndex(0);
		setHighlightTarget(null);
		setHighlightRects([]);
	}, [pageResetKey]);

	useEffect(() => {
		const textContent = pageTextContentRef.current;
		if (!textContent) {
			setFindTargets([]);
			setActiveFindIndex(0);
			return;
		}
		setFindTargets(buildFindTargets(textContent, findQuery));
		setActiveFindIndex(0);
	}, [findQuery]);

	useEffect(() => {
		if (activeFindIndex >= findTargets.length) {
			setActiveFindIndex(Math.max(0, findTargets.length - 1));
		}
	}, [activeFindIndex, findTargets.length]);

	const handleZoomOut = () => {
		setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP));
	};

	const handleZoomIn = () => {
		setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP));
	};

	const scrollToTopLeft = () => {
		window.requestAnimationFrame(() => {
			scrollRef.current?.scrollTo({ top: 0, left: 0 });
		});
	};

	const handleResetZoom = () => {
		setZoom(1);
		scrollToTopLeft();
	};

	const handlePreviousPage = () => {
		setCurrentPage((page) => Math.max(1, page - 1));
		scrollToTopLeft();
	};

	const handleNextPage = () => {
		setCurrentPage((page) =>
			numPages > 0 ? Math.min(numPages, page + 1) : page + 1,
		);
		scrollToTopLeft();
	};

	const handlePreviousFind = () => {
		setActiveFindIndex((index) =>
			findMatchCount > 0 ? (index - 1 + findMatchCount) % findMatchCount : 0,
		);
	};

	const handleNextFind = () => {
		setActiveFindIndex((index) =>
			findMatchCount > 0 ? (index + 1) % findMatchCount : 0,
		);
	};

	const handlePanStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		if (
			(event.target as HTMLElement).closest("button,a,input,textarea,select")
		) {
			return;
		}
		const viewport = scrollRef.current;
		if (!viewport) return;

		panRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			scrollLeft: viewport.scrollLeft,
			scrollTop: viewport.scrollTop,
		};
		viewport.setPointerCapture(event.pointerId);
		setIsPanning(true);
	};

	const handlePanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		const viewport = scrollRef.current;
		if (!pan || !viewport || pan.pointerId !== event.pointerId) return;

		viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
		viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
	};

	const handlePanEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		const viewport = scrollRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;

		if (viewport?.hasPointerCapture(event.pointerId)) {
			viewport.releasePointerCapture(event.pointerId);
		}
		panRef.current = null;
		setIsPanning(false);
	};

	const handleGetTextSuccess = useCallback(
		(textContent: unknown) => {
			pageTextContentRef.current = textContent;
			setHighlightTarget(
				buildHighlightTarget(textContent, activeHighlightText),
			);
			setFindTargets(buildFindTargets(textContent, findQuery));
			setActiveFindIndex(0);
		},
		[activeHighlightText, findQuery],
	);

	const measureCurrentHighlights = useCallback(() => {
		setHighlightRects(
			measureHighlightOverlays({
				root: scrollRef.current,
				pageFrame: pageFrameRef.current,
				citationTarget: highlightTarget,
				findTargets,
				activeFindIndex,
				hasFindQuery,
			}),
		);
	}, [activeFindIndex, findTargets, hasFindQuery, highlightTarget]);

	useEffect(() => {
		window.requestAnimationFrame(measureCurrentHighlights);
	}, [measureCurrentHighlights]);

	const handleRenderTextLayerSuccess = useCallback(() => {
		window.requestAnimationFrame(measureCurrentHighlights);
	}, [measureCurrentHighlights]);

	const renderTextLayerItem = useCallback(
		({ str, itemIndex }: { str: string; itemIndex: number }) =>
			renderTextItem(str, itemIndex),
		[],
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onOpenChange(null);
			}}
		>
			<DialogContent
				className="h-[min(90vh,880px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
				closeButtonClassName="top-1.5 right-3"
				style={{ width: "min(86vw, 1120px)", maxWidth: "none" }}
			>
				<DialogHeader className="border-b px-4 py-2 pr-12">
					<div className="flex min-w-0 items-center justify-between gap-3">
						<DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
							<FileText className="size-3.5 shrink-0 text-neutral-500" />
							<span className="truncate">{request.filename}</span>
						</DialogTitle>
						<DialogDescription className="sr-only">
							PDF preview
						</DialogDescription>

						<div className="flex h-6 min-w-0 shrink-0 items-center gap-0.5 rounded-md bg-neutral-50/70 px-1.5 text-neutral-500 transition-colors focus-within:bg-white focus-within:ring-1 focus-within:ring-neutral-200 sm:w-48">
							<Search className="size-3 shrink-0 text-neutral-400/80" />
							<Input
								value={findQuery}
								onChange={(event) => setFindQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										if (event.shiftKey) {
											handlePreviousFind();
										} else {
											handleNextFind();
										}
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setFindQuery("");
										event.currentTarget.blur();
									}
								}}
								placeholder="Search"
								aria-label="Find in PDF"
								className="h-5 flex-1 border-0 bg-transparent px-1 py-0 text-[11px] text-neutral-600 placeholder:text-neutral-400 focus-visible:ring-0 md:text-[11px]"
							/>
							{findQuery.trim() ? (
								<span className="min-w-10 text-right text-[11px] tabular-nums text-neutral-400">
									{activeFindOrdinal}/{findMatchCount}
								</span>
							) : null}
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								disabled={findMatchCount === 0}
								onClick={handlePreviousFind}
								aria-label="Previous match"
							>
								<ChevronUp className="size-3" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								disabled={findMatchCount === 0}
								onClick={handleNextFind}
								aria-label="Next match"
							>
								<ChevronDown className="size-3" />
							</Button>
							{findQuery ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									onClick={() => {
										setFindQuery("");
									}}
									aria-label="Clear find"
								>
									<X className="size-3" />
								</Button>
							) : null}
						</div>
					</div>
				</DialogHeader>

				<div
					ref={setViewportElement}
					className={`min-h-0 flex-1 overflow-auto bg-neutral-100 px-4 py-4 ${
						isPanning ? "cursor-grabbing select-none" : "cursor-grab"
					}`}
					onPointerDown={handlePanStart}
					onPointerMove={handlePanMove}
					onPointerUp={handlePanEnd}
					onPointerCancel={handlePanEnd}
				>
					{pdfError && (
						<div className="mx-auto max-w-xl rounded-md bg-red-50 p-3 text-sm text-red-600">
							{pdfError}
						</div>
					)}

					<PDFDocument
						file={getDocumentUrl(request.documentId)}
						onLoadSuccess={({ numPages: pages }) => {
							setNumPages(pages);
							setCurrentPage((page) => Math.min(Math.max(1, page), pages));
							setPdfError(null);
						}}
						onLoadError={(error) => {
							setPdfError(`Failed to load PDF: ${error.message}`);
						}}
						loading={
							<div className="flex items-center justify-center py-16">
								<Loader2 className="size-6 animate-spin text-neutral-400" />
							</div>
						}
					>
						<div
							ref={pageFrameRef}
							className="relative mx-auto overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
							style={{
								width: pageRenderWidth,
							}}
						>
							<Page
								key={`${request.documentId}:${currentPage}`}
								pageNumber={currentPage}
								width={pageRenderWidth}
								customTextRenderer={renderTextLayerItem}
								onGetTextSuccess={handleGetTextSuccess}
								onRenderTextLayerSuccess={handleRenderTextLayerSuccess}
								loading={
									<div className="flex items-center justify-center py-16">
										<Loader2 className="size-5 animate-spin text-neutral-300" />
									</div>
								}
							/>
							{highlightRects.map((overlay) => {
								const rect = overlay.rect;
								return (
									<div
										key={`${rect.left}:${rect.top}:${rect.width}:${rect.height}:${overlay.active}`}
										className="pdf-citation-highlight-rect"
										style={{
											position: "absolute",
											zIndex: overlay.active ? 6 : 5,
											pointerEvents: "none",
											borderRadius: 2,
											backgroundColor: overlay.active
												? "rgb(245 158 11 / 0.5)"
												: "rgb(252 211 77 / 0.32)",
											mixBlendMode: "multiply",
											left: rect.left,
											top: rect.top,
											width: rect.width,
											height: rect.height,
										}}
									/>
								);
							})}
						</div>
					</PDFDocument>
				</div>

				<div className="flex items-center justify-between gap-3 border-t bg-white px-4 py-2.5">
					<div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
						<Move className="size-3.5 shrink-0" />
						<span className="truncate">Drag to pan</span>
					</div>

					<div className="flex items-center justify-center gap-3">
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={currentPage <= 1}
							onClick={handlePreviousPage}
							aria-label="Previous page"
						>
							<ChevronLeft className="size-4" />
						</Button>
						<span className="min-w-24 text-center text-xs text-neutral-500">
							Page {currentPage}
							{numPages > 0 ? ` of ${numPages}` : ""}
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={numPages > 0 && currentPage >= numPages}
							onClick={handleNextPage}
							aria-label="Next page"
						>
							<ChevronRight className="size-4" />
						</Button>
					</div>

					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={zoom <= MIN_ZOOM}
							onClick={handleZoomOut}
							aria-label="Zoom out"
						>
							<ZoomOut className="size-4" />
						</Button>
						<span className="min-w-12 text-center text-xs tabular-nums text-neutral-500">
							{zoomLabel}
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={zoom >= MAX_ZOOM}
							onClick={handleZoomIn}
							aria-label="Zoom in"
						>
							<ZoomIn className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							onClick={handleResetZoom}
							aria-label="Reset zoom"
						>
							<RotateCcw className="size-4" />
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
