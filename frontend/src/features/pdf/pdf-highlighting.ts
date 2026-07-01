interface RawPageText {
	text: string;
	charMap: ({ itemIndex: number; offset: number } | null)[];
}

export interface TextLayerHighlightTarget {
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

export interface HighlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface HighlightOverlay {
	rect: HighlightRect;
	active: boolean;
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

export function buildHighlightTarget(
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

export function buildFindTargets(
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

export function renderTextItem(str: string, itemIndex: number): string {
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

export function measureHighlightOverlays({
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
