export const DOCUMENT_SOURCES_ARTIFACT_TYPE = "document_sources_v1";

export interface CitationMarker {
	chunkId: string;
	highlightText: string;
}

export interface DocumentSourceChunk {
	chunk_id: string;
	document_id: string;
	filename: string;
	page_no: number | null;
	chunk_index: number;
}

export interface DocumentSource {
	sourceType: "document";
	id: string;
	title: string;
	filename: string;
	mediaType: "application/pdf";
	chunks: DocumentSourceChunk[];
	pages: number[];
}

interface DocumentSourcesArtifact {
	type: typeof DOCUMENT_SOURCES_ARTIFACT_TYPE;
	chunks: DocumentSourceChunk[];
}

const CITATION_MARKER_OPEN = "[[";
const CITATION_MARKER_PREFIX = "[[cite:";
const CITATION_MARKER_END = "]]";
const CITATION_MARKER_RE = /\[\[cite:([^\]|\s]+)(?:\|([\s\S]*?))?\]\]/g;
const PENDING_CITATION_HREF = "#citation-pending";
const CITATION_TOKEN_START = "\u2063";
const CITATION_TOKEN_END = "\u2064";
const CITATION_TOKEN_PREFIX = `${CITATION_TOKEN_START}c`;
const CITATION_TOKEN_RE = /\u2063c:([a-z0-9-]+)\u2064/g;

const citationTokenRegistry = new Map<string, CitationMarker>();

export interface CitationRenderToken {
	href: string;
	label: string;
	pending: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSourceChunk(value: unknown): value is DocumentSourceChunk {
	if (!isRecord(value)) return false;
	return (
		typeof value.chunk_id === "string" &&
		typeof value.document_id === "string" &&
		typeof value.filename === "string" &&
		(typeof value.page_no === "number" || value.page_no === null) &&
		typeof value.chunk_index === "number"
	);
}

function isDocumentSourcesArtifact(
	value: unknown,
): value is DocumentSourcesArtifact {
	return (
		isRecord(value) &&
		value.type === DOCUMENT_SOURCES_ARTIFACT_TYPE &&
		Array.isArray(value.chunks) &&
		value.chunks.every(isSourceChunk)
	);
}

export function extractSourceChunksFromArtifact(
	artifact: unknown,
): DocumentSourceChunk[] {
	if (!isDocumentSourcesArtifact(artifact)) return [];
	return artifact.chunks;
}

export function citationMarkerToHref(marker: CitationMarker): string {
	return `#citation:${encodeURIComponent(JSON.stringify(marker))}`;
}

export function citationHrefToMarker(href: string): CitationMarker | null {
	if (!href.startsWith("#citation:")) return null;
	try {
		const decoded = JSON.parse(
			decodeURIComponent(href.slice("#citation:".length)),
		);
		if (
			isRecord(decoded) &&
			typeof decoded.chunkId === "string" &&
			typeof decoded.highlightText === "string"
		) {
			return {
				chunkId: decoded.chunkId,
				highlightText: decoded.highlightText,
			};
		}
	} catch {
		return null;
	}
	return null;
}

export function isPendingCitationHref(href: string): boolean {
	return href === PENDING_CITATION_HREF;
}

export function shortChunkId(chunkId: string): string {
	return chunkId.length <= 8 ? chunkId : chunkId.slice(0, 8);
}

export function preprocessCitationMarkers(text: string): string {
	const tokenizedText = text.replace(
		CITATION_MARKER_RE,
		(_match, rawChunkId, rawText = "") =>
			citationTokenFor(String(rawChunkId), String(rawText)),
	);

	return replaceTrailingIncompleteCitationMarker(tokenizedText);
}

function citationTokenFor(
	rawChunkId: string,
	rawHighlightText: string,
): string {
	const chunkId = rawChunkId.trim();
	if (!chunkId) return "";
	const highlightText = rawHighlightText.trim();
	const tokenId = citationTokenId(chunkId, highlightText);
	citationTokenRegistry.set(tokenId, { chunkId, highlightText });
	return `${CITATION_TOKEN_PREFIX}:${tokenId}${CITATION_TOKEN_END}`;
}

function replaceTrailingIncompleteCitationMarker(text: string): string {
	const markerStart = text.lastIndexOf(CITATION_MARKER_OPEN);
	if (markerStart !== -1) {
		const markerTail = text.slice(markerStart);
		if (
			!markerTail.includes(CITATION_MARKER_END) &&
			isIncompleteCitationMarker(markerTail)
		) {
			return appendPendingCitationToken(text.slice(0, markerStart));
		}
	}

	for (let length = CITATION_MARKER_PREFIX.length; length >= 1; length -= 1) {
		const partialPrefix = CITATION_MARKER_PREFIX.slice(0, length);
		if (text.endsWith(partialPrefix)) {
			return text.slice(0, -length).trimEnd();
		}
	}

	return text;
}

function isIncompleteCitationMarker(value: string): boolean {
	return (
		CITATION_MARKER_PREFIX.startsWith(value) ||
		value.startsWith(CITATION_MARKER_PREFIX)
	);
}

function appendPendingCitationToken(value: string): string {
	const trimmed = value.trimEnd();
	if (!trimmed) return CITATION_TOKEN_PREFIX;
	return `${trimmed} ${CITATION_TOKEN_PREFIX}`;
}

function citationTokenId(chunkId: string, highlightText: string): string {
	return `${shortChunkId(chunkId).toLowerCase()}-${hashString(`${chunkId}\0${highlightText}`)}`;
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

export function extractCitationRenderTokens(
	value: string,
): Array<CitationRenderToken | string> {
	const parts: Array<CitationRenderToken | string> = [];
	let lastIndex = 0;

	for (const match of value.matchAll(CITATION_TOKEN_RE)) {
		const [rawToken, tokenId] = match;
		if (!tokenId) continue;
		if (match.index > lastIndex) {
			parts.push(value.slice(lastIndex, match.index));
		}

		const marker = citationTokenRegistry.get(tokenId);
		parts.push(
			marker
				? {
						href: citationMarkerToHref(marker),
						label: `#${shortChunkId(marker.chunkId)}`,
						pending: false,
					}
				: pendingCitationRenderToken(),
		);
		lastIndex = match.index + rawToken.length;
	}

	if (lastIndex < value.length) {
		appendTextOrPendingCitation(parts, value.slice(lastIndex));
	}

	return parts.length > 0 ? parts : [value];
}

function appendTextOrPendingCitation(
	parts: Array<CitationRenderToken | string>,
	value: string,
) {
	const pendingStart = value.lastIndexOf(CITATION_TOKEN_START);
	if (pendingStart === -1) {
		parts.push(value);
		return;
	}

	const beforePending = value.slice(0, pendingStart);
	if (beforePending) parts.push(beforePending);
	parts.push(pendingCitationRenderToken());
}

function pendingCitationRenderToken(): CitationRenderToken {
	return {
		href: PENDING_CITATION_HREF,
		label: "#",
		pending: true,
	};
}

export function extractSourceChunksFromParts(
	parts: readonly unknown[],
): DocumentSourceChunk[] {
	const chunks: DocumentSourceChunk[] = [];
	const seen = new Set<string>();

	for (const part of parts) {
		if (!isRecord(part) || part.type !== "tool-call") continue;
		for (const chunk of extractSourceChunksFromArtifact(part.artifact)) {
			if (seen.has(chunk.chunk_id)) continue;
			seen.add(chunk.chunk_id);
			chunks.push(chunk);
		}
	}

	return chunks;
}

export function extractDocumentSourcesFromParts(
	parts: readonly unknown[],
): DocumentSource[] {
	const byDocument = new Map<string, DocumentSource>();
	for (const chunk of extractSourceChunksFromParts(parts)) {
		const existing = byDocument.get(chunk.document_id);
		if (existing) {
			existing.chunks.push(chunk);
			if (chunk.page_no !== null && !existing.pages.includes(chunk.page_no)) {
				existing.pages.push(chunk.page_no);
			}
			continue;
		}

		byDocument.set(chunk.document_id, {
			sourceType: "document",
			id: chunk.document_id,
			title: chunk.filename,
			filename: chunk.filename,
			mediaType: "application/pdf",
			chunks: [chunk],
			pages: chunk.page_no === null ? [] : [chunk.page_no],
		});
	}

	return [...byDocument.values()].map((source) => ({
		...source,
		pages: [...source.pages].sort((a, b) => a - b),
	}));
}

export function getSourceChunkById(
	parts: readonly unknown[],
	chunkId: string,
): DocumentSourceChunk | null {
	return (
		extractSourceChunksFromParts(parts).find(
			(chunk) => chunk.chunk_id === chunkId,
		) ?? null
	);
}
