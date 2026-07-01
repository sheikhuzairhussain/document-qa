import type { Thread } from "@langchain/langgraph-sdk";
import { agentsClient } from "@/lib/agents";

/**
 * Tracks which documents are marked as focus documents for each chat, so focus
 * state can be recorded on the frontend before its Aegra thread exists.
 *
 * Flow:
 * - A brand-new chat has a client-generated draft id ({@link getDraftId}).
 *   Uploads there are stored locally against that id.
 * - When the thread is created (the thread-list adapter's `initialize`, right
 *   before the first message), the draft id becomes the real Aegra `thread_id`
 *   and the focus ids are written to the thread's `focus_documents` metadata.
 * - For an existing chat, focus changes update that metadata directly.
 *
 * `focus_documents` is private runtime context exposed to the agent.
 */
export const FOCUS_DOCUMENTS_KEY = "focus_documents";
export const AVAILABLE_DOCUMENTS_KEY = "available_documents";
const EMPTY: readonly string[] = [];

type Listener = () => void;
type ThreadDocuments = { threadId: string; docIds: readonly string[] };

const threadMetadataQueues = new Map<string, Promise<Thread>>();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await operation();
		} catch (err) {
			lastError = err;
			if (attempt < 2) await sleep(300 * (attempt + 1));
		}
	}
	throw lastError;
}

/**
 * Serialize metadata writes per thread and merge with the latest server metadata
 * before patching. This keeps focus documents, title, and archive state from
 * clobbering each other when separate UI actions happen close together.
 */
export function updateThreadMetadata(
	threadId: string,
	metadataPatch: Record<string, unknown>,
): Promise<Thread> {
	const previous = threadMetadataQueues.get(threadId) ?? Promise.resolve(null);
	const next = previous
		.catch(() => null)
		.then(() =>
			withRetry(async () => {
				const thread = await agentsClient.threads.get(threadId);
				return agentsClient.threads.update(threadId, {
					metadata: {
						...(thread.metadata ?? {}),
						...metadataPatch,
					},
				});
			}),
		);

	const queued = next.finally(() => {
		if (threadMetadataQueues.get(threadId) === queued) {
			threadMetadataQueues.delete(threadId);
		}
	});
	threadMetadataQueues.set(threadId, queued);

	return next;
}

class FocusDocumentsStore {
	private draftId = crypto.randomUUID();
	private docs = new Map<string, readonly string[]>();
	private listeners = new Set<Listener>();
	private version = 0;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getVersion = (): number => this.version;

	private emit() {
		this.version += 1;
		for (const listener of this.listeners) listener();
	}

	/** The id to use for the current brand-new chat before its thread exists. */
	getDraftId(): string {
		return this.draftId;
	}

	/** Begin a fresh draft for the next new chat. */
	rotateDraft(): void {
		this.draftId = crypto.randomUUID();
		this.emit();
	}

	isCurrentDraft(threadId: string): boolean {
		return threadId === this.draftId;
	}

	getDocuments(threadId: string): readonly string[] {
		return this.docs.get(threadId) ?? EMPTY;
	}

	hasThread(threadId: string): boolean {
		return this.docs.has(threadId);
	}

	/** Seed a thread's focus documents from server metadata. */
	setDocuments(threadId: string, docIds: readonly string[]): void {
		this.docs.set(threadId, [...docIds]);
		this.emit();
	}

	/** Merge server metadata with any local changes made while hydration was pending. */
	mergeDocuments(
		threadId: string,
		docIds: readonly string[],
	): readonly string[] {
		const current = this.docs.get(threadId) ?? EMPTY;
		const next = [...new Set([...current, ...docIds])];
		this.docs.set(threadId, next);
		this.emit();
		return next;
	}

	addDocument(threadId: string, docId: string): readonly string[] {
		const current = this.docs.get(threadId) ?? EMPTY;
		if (current.includes(docId)) return current;
		const next = [...current, docId];
		this.docs.set(threadId, next);
		this.emit();
		return next;
	}

	removeDocument(threadId: string, docId: string): readonly string[] {
		const current = this.docs.get(threadId) ?? EMPTY;
		if (!current.includes(docId)) return current;
		const next = current.filter((id) => id !== docId);
		this.docs.set(threadId, next);
		this.emit();
		return next;
	}

	removeDocumentEverywhere(docId: string): ThreadDocuments[] {
		const changed: ThreadDocuments[] = [];
		for (const [threadId, current] of this.docs) {
			if (!current.includes(docId)) continue;
			const next = current.filter((id) => id !== docId);
			this.docs.set(threadId, next);
			changed.push({ threadId, docIds: next });
		}
		if (changed.length > 0) this.emit();
		return changed;
	}
}

export const focusDocumentsStore = new FocusDocumentsStore();

/** Read the `focus_documents` list off an Aegra thread's metadata. */
export function readFocusDocuments(thread: Thread): string[] {
	const value = thread.metadata?.[FOCUS_DOCUMENTS_KEY];
	return Array.isArray(value)
		? value.filter((id): id is string => typeof id === "string")
		: [];
}

/** Build the metadata patch that records a chat's focus documents. */
export function focusDocumentsMetadata(
	docIds: readonly string[],
): Record<string, unknown> {
	return { [FOCUS_DOCUMENTS_KEY]: [...docIds] };
}

/** Persist focus documents onto an already-created Aegra thread. */
export async function persistFocusDocuments(
	threadId: string,
	docIds: readonly string[],
): Promise<void> {
	await updateThreadMetadata(threadId, focusDocumentsMetadata(docIds));
}
