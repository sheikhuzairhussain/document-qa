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
	type PropsWithChildren,
	type PointerEvent as ReactPointerEvent,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Document as PDFDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "@/lib/api";
import type { DocumentChunkCitation } from "@/types";
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

interface PdfViewerRequest {
	documentId: string;
	filename: string;
	pageNo?: number | null;
	highlightText?: string;
	citation?: DocumentChunkCitation | null;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

interface RawPageText {
	text: string;
	charMap: ({ itemIndex: number; offset: number } | null)[];
}

interface TextLayerHighlightTarget {
	startItemIndex: number;
	startOffset: number;
	endItemIndex: number;
	endOffset: number;
}

interface NormalizedText {
	normalized: string;
	sourceIndices: number[];
}

interface SearchToken {
	value: string;
	rawStart: number;
	rawEnd: number;
}

interface RawTextSpan {
	start: number;
	end: number;
}

interface HighlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface HighlightOverlay {
	rect: HighlightRect;
	active: boolean;
}

interface PdfViewerContextValue {
	openDocument: (request: PdfViewerRequest) => void;
}

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

export function PdfViewerProvider({ children }: PropsWithChildren) {
	const [request, setRequest] = useState<PdfViewerRequest | null>(null);

	const openDocument = useCallback((nextRequest: PdfViewerRequest) => {
		setRequest(nextRequest);
	}, []);

	return (
		<PdfViewerContext.Provider value={{ openDocument }}>
			{children}
			<PdfViewerDialog request={request} onOpenChange={setRequest} />
		</PdfViewerContext.Provider>
	);
}

export function usePdfViewer(): PdfViewerContextValue {
	const context = useContext(PdfViewerContext);
	if (!context) {
		throw new Error("usePdfViewer must be used within PdfViewerProvider");
	}
	return context;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"have",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"was",
	"were",
	"with",
]);

function foldSearchText(value: string): string {
	return value
		.replace(/\u00ad/g, "")
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u2018\u2019\u201a\u201b]/g, "'")
		.replace(/[\u201c\u201d\u201e\u201f]/g, '"')
		.normalize("NFKD")
		.replace(/\p{Mark}/gu, "")
		.toLowerCase();
}

function isSearchTokenChar(value: string): boolean {
	return /[\p{Letter}\p{Number}]/u.test(value);
}

function normalizedTextWithMap(
	text: string,
	mode: "spaced" | "compact",
): NormalizedText {
	let normalized = "";
	const sourceIndices: number[] = [];
	let pendingSpaceIndex: number | null = null;

	for (let index = 0; index < text.length; index += 1) {
		const folded = foldSearchText(text[index] ?? "");
		if (!folded) continue;

		for (const char of folded) {
			if (mode === "compact") {
				if (!isSearchTokenChar(char)) continue;
				normalized += char;
				sourceIndices.push(index);
				continue;
			}

			if (/\s/u.test(char)) {
				if (normalized.length > 0) pendingSpaceIndex = index;
				continue;
			}

			if (pendingSpaceIndex !== null && normalized.length > 0) {
				normalized += " ";
				sourceIndices.push(pendingSpaceIndex);
			}
			normalized += char;
			sourceIndices.push(index);
			pendingSpaceIndex = null;
		}
	}

	return { normalized, sourceIndices };
}

function textItemsFromContent(
	textContent: unknown,
): { itemIndex: number; str: string }[] {
	if (!isRecord(textContent) || !Array.isArray(textContent.items)) return [];

	return textContent.items.flatMap((item, itemIndex) => {
		if (!isRecord(item) || typeof item.str !== "string") return [];
		return [{ itemIndex, str: item.str }];
	});
}

function pageTextFromContent(textContent: unknown): RawPageText {
	const textItems = textItemsFromContent(textContent);
	const rawParts: string[] = [];
	const charMap: ({ itemIndex: number; offset: number } | null)[] = [];

	for (const item of textItems) {
		if (rawParts.length > 0) {
			rawParts.push(" ");
			charMap.push(null);
		}

		for (let offset = 0; offset < item.str.length; offset += 1) {
			rawParts.push(item.str[offset] ?? "");
			charMap.push({ itemIndex: item.itemIndex, offset });
		}
	}

	return { text: rawParts.join(""), charMap };
}

function rawSpanForNormalizedMatch(
	pageText: string,
	query: string,
	mode: "spaced" | "compact",
): RawTextSpan | null {
	const normalizedPage = normalizedTextWithMap(pageText, mode);
	const normalizedQuery = normalizedTextWithMap(query, mode);
	if (!normalizedQuery.normalized) return null;

	const normalizedStart = normalizedPage.normalized.indexOf(
		normalizedQuery.normalized,
	);
	if (normalizedStart === -1) return null;

	const rawStart = normalizedPage.sourceIndices[normalizedStart];
	const rawEnd =
		normalizedPage.sourceIndices[
			normalizedStart + normalizedQuery.normalized.length - 1
		];
	if (rawStart === undefined || rawEnd === undefined) return null;

	return {
		start: Math.min(rawStart, rawEnd),
		end: Math.max(rawStart, rawEnd) + 1,
	};
}

function rawSpansForNormalizedMatches(
	pageText: string,
	query: string,
	mode: "spaced" | "compact",
): RawTextSpan[] {
	const normalizedPage = normalizedTextWithMap(pageText, mode);
	const normalizedQuery = normalizedTextWithMap(query, mode);
	if (!normalizedQuery.normalized) return [];

	const spans: RawTextSpan[] = [];
	let searchStart = 0;
	while (searchStart < normalizedPage.normalized.length) {
		const normalizedStart = normalizedPage.normalized.indexOf(
			normalizedQuery.normalized,
			searchStart,
		);
		if (normalizedStart === -1) break;

		const rawStart = normalizedPage.sourceIndices[normalizedStart];
		const rawEnd =
			normalizedPage.sourceIndices[
				normalizedStart + normalizedQuery.normalized.length - 1
			];
		if (rawStart !== undefined && rawEnd !== undefined) {
			spans.push({
				start: Math.min(rawStart, rawEnd),
				end: Math.max(rawStart, rawEnd) + 1,
			});
		}

		searchStart =
			normalizedStart + Math.max(1, normalizedQuery.normalized.length);
	}

	return spans;
}

function tokenizeSearchText(text: string): SearchToken[] {
	const tokens: SearchToken[] = [];
	let current: SearchToken | null = null;

	const pushCurrent = () => {
		if (!current) return;
		tokens.push(current);
		current = null;
	};

	for (let index = 0; index < text.length; index += 1) {
		const folded = foldSearchText(text[index] ?? "");
		if (!folded) continue;

		for (const char of folded) {
			if (isSearchTokenChar(char)) {
				current ??= { value: "", rawStart: index, rawEnd: index + 1 };
				current.value += char;
				current.rawEnd = index + 1;
			} else {
				pushCurrent();
			}
		}
	}

	pushCurrent();
	return tokens;
}

function normalizeOrdinalToken(token: string): string {
	return token.replace(/^(\d+)(st|nd|rd|th)$/u, "$1");
}

function isImportantToken(token: string): boolean {
	return /\d/u.test(token) || (token.length >= 3 && !STOP_WORDS.has(token));
}

function isOneEditApart(a: string, b: string): boolean {
	if (a === b || Math.abs(a.length - b.length) > 1) return false;

	let indexA = 0;
	let indexB = 0;
	let edits = 0;

	while (indexA < a.length && indexB < b.length) {
		if (a[indexA] === b[indexB]) {
			indexA += 1;
			indexB += 1;
			continue;
		}

		edits += 1;
		if (edits > 1) return false;

		if (a.length > b.length) {
			indexA += 1;
		} else if (b.length > a.length) {
			indexB += 1;
		} else {
			indexA += 1;
			indexB += 1;
		}
	}

	return true;
}

function tokenMatchScore(pageToken: string, queryToken: string): number {
	if (pageToken === queryToken) return isImportantToken(queryToken) ? 4 : 1;
	if (normalizeOrdinalToken(pageToken) === normalizeOrdinalToken(queryToken)) {
		return 3;
	}
	if (
		isImportantToken(queryToken) &&
		pageToken.length >= 5 &&
		queryToken.length >= 5 &&
		isOneEditApart(pageToken, queryToken)
	) {
		return 2;
	}
	return -3;
}

function rawSpanForFuzzyTokenMatch(
	pageText: string,
	query: string,
): RawTextSpan | null {
	const pageTokens = tokenizeSearchText(pageText);
	const queryTokens = tokenizeSearchText(query);
	if (!pageTokens.length || !queryTokens.length) return null;

	const width = queryTokens.length + 1;
	const scores = new Int16Array((pageTokens.length + 1) * width);
	const moves = new Uint8Array((pageTokens.length + 1) * width);
	const at = (pageIndex: number, queryIndex: number) =>
		pageIndex * width + queryIndex;
	let bestScore = 0;
	let bestIndex = 0;

	for (let pageIndex = 1; pageIndex <= pageTokens.length; pageIndex += 1) {
		for (
			let queryIndex = 1;
			queryIndex <= queryTokens.length;
			queryIndex += 1
		) {
			const matchScore = tokenMatchScore(
				pageTokens[pageIndex - 1]?.value ?? "",
				queryTokens[queryIndex - 1]?.value ?? "",
			);
			const diag =
				(scores[at(pageIndex - 1, queryIndex - 1)] ?? 0) + matchScore;
			const up = (scores[at(pageIndex - 1, queryIndex)] ?? 0) - 1;
			const left = (scores[at(pageIndex, queryIndex - 1)] ?? 0) - 1;
			let score = 0;
			let move = 0;

			if (diag > score) {
				score = diag;
				move = 1;
			}
			if (up > score) {
				score = up;
				move = 2;
			}
			if (left > score) {
				score = left;
				move = 3;
			}

			scores[at(pageIndex, queryIndex)] = score;
			moves[at(pageIndex, queryIndex)] = move;

			if (score > bestScore) {
				bestScore = score;
				bestIndex = at(pageIndex, queryIndex);
			}
		}
	}

	if (bestScore === 0) return null;

	let pageIndex = Math.floor(bestIndex / width);
	let queryIndex = bestIndex % width;
	const matchedTokens: SearchToken[] = [];
	const matchedImportantQueryIndexes = new Set<number>();

	while (
		pageIndex > 0 &&
		queryIndex > 0 &&
		(scores[at(pageIndex, queryIndex)] ?? 0) > 0
	) {
		const move = moves[at(pageIndex, queryIndex)];
		if (move === 1) {
			const pageToken = pageTokens[pageIndex - 1];
			const queryToken = queryTokens[queryIndex - 1];
			if (
				pageToken &&
				queryToken &&
				tokenMatchScore(pageToken.value, queryToken.value) > 0
			) {
				matchedTokens.push(pageToken);
				if (isImportantToken(queryToken.value)) {
					matchedImportantQueryIndexes.add(queryIndex - 1);
				}
			}
			pageIndex -= 1;
			queryIndex -= 1;
		} else if (move === 2) {
			pageIndex -= 1;
		} else if (move === 3) {
			queryIndex -= 1;
		} else {
			break;
		}
	}

	const importantQueryCount = queryTokens.filter((token) =>
		isImportantToken(token.value),
	).length;
	const minimumImportantMatches =
		importantQueryCount <= 1
			? importantQueryCount
			: Math.min(3, Math.ceil(importantQueryCount * 0.45));

	if (
		importantQueryCount > 0 &&
		matchedImportantQueryIndexes.size < minimumImportantMatches
	) {
		return null;
	}

	if (bestScore < (queryTokens.length <= 2 ? 3 : 6)) return null;
	if (!matchedTokens.length) return null;

	return {
		start: Math.min(...matchedTokens.map((token) => token.rawStart)),
		end: Math.max(...matchedTokens.map((token) => token.rawEnd)),
	};
}

function highlightTargetFromRawSpan(
	span: RawTextSpan | null,
	charMap: RawPageText["charMap"],
): TextLayerHighlightTarget | null {
	if (!span) return null;

	let firstMapped: { itemIndex: number; offset: number } | null = null;
	let lastMapped: { itemIndex: number; offset: number } | null = null;
	for (let rawIndex = span.start; rawIndex < span.end; rawIndex += 1) {
		const mapped = charMap[rawIndex];
		if (!mapped) continue;
		firstMapped ??= mapped;
		lastMapped = mapped;
	}

	if (!firstMapped || !lastMapped) return null;

	return {
		startItemIndex: firstMapped.itemIndex,
		startOffset: firstMapped.offset,
		endItemIndex: lastMapped.itemIndex,
		endOffset: lastMapped.offset + 1,
	};
}

function buildHighlightTarget(
	textContent: unknown,
	highlightText: string,
): TextLayerHighlightTarget | null {
	const query = highlightText.trim();
	if (!query) return null;

	const pageText = pageTextFromContent(textContent);
	let rawSpan = rawSpanForNormalizedMatch(pageText.text, query, "spaced");
	if (!rawSpan) {
		rawSpan = rawSpanForNormalizedMatch(pageText.text, query, "compact");
	}
	if (!rawSpan) {
		rawSpan = rawSpanForFuzzyTokenMatch(pageText.text, query);
	}

	return highlightTargetFromRawSpan(rawSpan, pageText.charMap);
}

function buildFindTargets(
	textContent: unknown,
	query: string,
): TextLayerHighlightTarget[] {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return [];

	const pageText = pageTextFromContent(textContent);
	let rawSpans = rawSpansForNormalizedMatches(
		pageText.text,
		trimmedQuery,
		"spaced",
	);
	if (!rawSpans.length) {
		rawSpans = rawSpansForNormalizedMatches(
			pageText.text,
			trimmedQuery,
			"compact",
		);
	}

	return rawSpans.flatMap((span) => {
		const target = highlightTargetFromRawSpan(span, pageText.charMap);
		return target ? [target] : [];
	});
}

function renderTextItem(str: string, itemIndex: number): string {
	return `<span data-pdf-text-item-index="${itemIndex}">${escapeHtml(str)}</span>`;
}

function textNodeForHighlightItem(
	root: HTMLElement,
	itemIndex: number,
): { element: HTMLElement; node: Text } | null {
	const element = root.querySelector<HTMLElement>(
		`[data-pdf-text-item-index="${itemIndex}"]`,
	);
	const node = element?.firstChild;
	if (!element || !node || node.nodeType !== Node.TEXT_NODE) return null;
	return { element, node: node as Text };
}

function mergeHighlightRects(rects: HighlightRect[]): HighlightRect[] {
	const sortedRects = rects
		.filter((rect) => rect.width > 0 && rect.height > 0)
		.sort((a, b) => a.top - b.top || a.left - b.left);
	const mergedRects: HighlightRect[] = [];

	for (const rect of sortedRects) {
		const lastRect = mergedRects.at(-1);
		const rectCenter = rect.top + rect.height / 2;
		const lastCenter = lastRect ? lastRect.top + lastRect.height / 2 : 0;
		const lineThreshold = lastRect
			? Math.max(4, Math.min(lastRect.height, rect.height) * 0.75)
			: 4;

		if (lastRect && Math.abs(rectCenter - lastCenter) <= lineThreshold) {
			const left = Math.min(lastRect.left, rect.left);
			const top = Math.min(lastRect.top, rect.top);
			const right = Math.max(
				lastRect.left + lastRect.width,
				rect.left + rect.width,
			);
			const bottom = Math.max(
				lastRect.top + lastRect.height,
				rect.top + rect.height,
			);
			lastRect.left = left;
			lastRect.top = top;
			lastRect.width = right - left;
			lastRect.height = bottom - top;
			continue;
		}

		mergedRects.push({ ...rect });
	}

	return mergedRects;
}

function measurePdfHighlight(
	root: HTMLElement | null,
	pageFrame: HTMLElement | null,
	target: TextLayerHighlightTarget | null,
	options: { scrollIntoView: boolean },
): HighlightRect[] {
	if (!root || !pageFrame || !target) return [];

	const start = textNodeForHighlightItem(root, target.startItemIndex);
	const end = textNodeForHighlightItem(root, target.endItemIndex);
	if (!start || !end) return [];

	const range = document.createRange();
	const startLength = start.node.textContent?.length ?? 0;
	const endLength = end.node.textContent?.length ?? 0;
	try {
		range.setStart(start.node, Math.min(target.startOffset, startLength));
		range.setEnd(end.node, Math.min(target.endOffset, endLength));
		const pageFrameRect = pageFrame.getBoundingClientRect();
		const rects = [...range.getClientRects()].map((rect) => ({
			left: rect.left - pageFrameRect.left,
			top: rect.top - pageFrameRect.top,
			width: rect.width,
			height: rect.height,
		}));
		if (options.scrollIntoView) {
			start.element.scrollIntoView({ block: "center", inline: "center" });
		}
		return mergeHighlightRects(rects);
	} catch {
		return [];
	}
}

function measureHighlightOverlays({
	root,
	pageFrame,
	citationTarget,
	findTargets,
	activeFindIndex,
	hasFindQuery,
}: {
	root: HTMLElement | null;
	pageFrame: HTMLElement | null;
	citationTarget: TextLayerHighlightTarget | null;
	findTargets: TextLayerHighlightTarget[];
	activeFindIndex: number;
	hasFindQuery: boolean;
}): HighlightOverlay[] {
	if (hasFindQuery) {
		return findTargets.flatMap((target, index) =>
			measurePdfHighlight(root, pageFrame, target, {
				scrollIntoView: index === activeFindIndex,
			}).map((rect) => ({ rect, active: index === activeFindIndex })),
		);
	}

	return measurePdfHighlight(root, pageFrame, citationTarget, {
		scrollIntoView: true,
	}).map((rect) => ({ rect, active: true }));
}

function PdfViewerDialog({
	request,
	onOpenChange,
}: {
	request: PdfViewerRequest | null;
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

	const requestedDocumentId = request?.documentId ?? null;
	const requestedPage = request?.pageNo ?? 1;
	useEffect(() => {
		setCurrentPage(Math.max(1, requestedPage));
		scrollRef.current?.scrollTo({ top: 0, left: 0 });
	}, [requestedPage]);

	useEffect(() => {
		if (requestedDocumentId === null) {
			setNumPages(0);
		} else {
			setZoom(1);
		}
		setPdfError(null);
		setFindQuery("");
		setFindTargets([]);
		setActiveFindIndex(0);
		pageTextContentRef.current = null;
	}, [requestedDocumentId]);

	const availablePageWidth = viewportWidth > 0 ? viewportWidth - 48 : 820;
	const basePageWidth = Math.max(280, Math.min(availablePageWidth, 820));
	const pageRenderWidth = Math.round(basePageWidth * zoom);
	const highlightText = request?.highlightText?.trim() ?? "";
	const highlightPage = request?.citation?.page_no ?? request?.pageNo ?? null;
	const hasFindQuery = findQuery.trim().length > 0;
	const activeHighlightText =
		!hasFindQuery && highlightPage !== null && currentPage === highlightPage
			? highlightText
			: "";
	const highlightKey = `${requestedDocumentId ?? ""}:${currentPage}:${activeHighlightText}`;
	const zoomLabel = `${Math.round(zoom * 100)}%`;
	const findMatchCount = findTargets.length;
	const activeFindOrdinal = findMatchCount === 0 ? 0 : activeFindIndex + 1;

	useEffect(() => {
		if (highlightKey === "") return;
		setHighlightTarget(null);
		setHighlightRects([]);
	}, [highlightKey]);

	useEffect(() => {
		if (requestedDocumentId === null || currentPage < 1) return;
		pageTextContentRef.current = null;
		setFindTargets([]);
		setActiveFindIndex(0);
		setHighlightTarget(null);
		setHighlightRects([]);
	}, [currentPage, requestedDocumentId]);

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
			open={request !== null}
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
							<span className="truncate">
								{request?.filename ?? "Document"}
							</span>
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

					{request && (
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
								{highlightRects.map((overlay, index) => {
									const rect = overlay.rect;
									return (
										<div
											key={`${index}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`}
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
					)}
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
