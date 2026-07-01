/** Ingestion lifecycle, mirrored from the backend. A document is only
 * queryable once it reaches "completed". */
export type DocumentStatus = "pending" | "processing" | "completed" | "failed";

export interface Document {
	id: string;
	filename: string;
	page_count: number;
	uploaded_at: string;
	status: DocumentStatus;
	/** Number of indexed chunks once processing completes. */
	chunk_count: number;
	/** Failure reason when status is "failed". */
	error?: string | null;
}

export type AvailableDocuments = "all" | string[];

export interface DocumentChunkCitation {
	chunk_id: string;
	document_id: string;
	filename: string;
	chunk_index: number;
	page_no: number | null;
}

/**
 * Which library documents are exposed to retrieval for a conversation. `"all"`
 * means every document in the library, current and future. An array is an
 * explicit allow-list. Focus documents are always included separately.
 */
export interface DocSelection {
	library: AvailableDocuments;
}
