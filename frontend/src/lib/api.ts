import type { Document } from "@/types";

const BASE = "/api";

async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const text = await response.text().catch(() => "Unknown error");
		throw new Error(`API error ${response.status}: ${text}`);
	}
	return response.json() as Promise<T>;
}

interface RequestOptions {
	signal?: AbortSignal;
}

/**
 * Upload a PDF into the document library. Documents are not tied to a
 * conversation on the server — the caller records the returned id against the
 * active chat when it should become a focus document.
 */
export async function uploadDocument(
	file: File,
	options: RequestOptions = {},
): Promise<Document> {
	const formData = new FormData();
	formData.append("file", file);
	const res = await fetch(`${BASE}/documents`, {
		method: "POST",
		body: formData,
		signal: options.signal,
	});
	return handleResponse<Document>(res);
}

/** Every document in the library. */
export async function fetchDocuments(
	options: RequestOptions = {},
): Promise<Document[]> {
	const res = await fetch(`${BASE}/documents`, { signal: options.signal });
	return handleResponse<Document[]>(res);
}

/** Re-run ingestion (chunking + embedding) for a document, e.g. after a failure. */
export async function reprocessDocument(
	documentId: string,
	options: RequestOptions = {},
): Promise<Document> {
	const res = await fetch(`${BASE}/documents/${documentId}/reprocess`, {
		method: "POST",
		signal: options.signal,
	});
	return handleResponse<Document>(res);
}

export async function deleteDocument(
	documentId: string,
	options: RequestOptions = {},
): Promise<void> {
	const res = await fetch(`${BASE}/documents/${documentId}`, {
		method: "DELETE",
		signal: options.signal,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export function getDocumentUrl(documentId: string): string {
	return `${BASE}/documents/${documentId}/content`;
}
