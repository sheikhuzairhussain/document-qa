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

const CITATION_MARKER_RE = /\[\[cite:([^\]|\s]+)(?:\|([\s\S]*?))?\]\]/g;
const CITATION_MARKER_PREFIX = "[[cite:";

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

export function shortChunkId(chunkId: string): string {
	return chunkId.length <= 8 ? chunkId : chunkId.slice(0, 8);
}

export function replaceCitationMarkersWithLinks(text: string): string {
	const linkedText = text.replace(
		CITATION_MARKER_RE,
		(_match, rawChunkId, rawText = "") => {
			const chunkId = String(rawChunkId).trim();
			const highlightText = String(rawText).trim();
			if (!chunkId) return "";
			const href = citationMarkerToHref({ chunkId, highlightText });
			return `[#${shortChunkId(chunkId)}](${href})`;
		},
	);

	return stripTrailingIncompleteCitationMarker(linkedText);
}

function stripTrailingIncompleteCitationMarker(text: string): string {
	const markerStart = text.lastIndexOf(CITATION_MARKER_PREFIX);
	if (markerStart !== -1 && !text.slice(markerStart).includes("]]")) {
		return text.slice(0, markerStart).trimEnd();
	}

	for (let length = CITATION_MARKER_PREFIX.length; length >= 2; length -= 1) {
		const partialPrefix = CITATION_MARKER_PREFIX.slice(0, length);
		if (text.endsWith(partialPrefix)) {
			return text.slice(0, -length).trimEnd();
		}
	}

	return text;
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
