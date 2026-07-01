import { normalizeAvailableDocuments } from "@/features/documents/available-documents";
import { parseUnknownRecord } from "@/features/documents/document-context-schemas";
import {
	AVAILABLE_DOCUMENTS_KEY,
	FOCUS_DOCUMENTS_KEY,
	focusDocumentsStore,
	readFocusDocuments,
} from "@/features/focus-documents/focus-documents-store";
import { agentsClient } from "@/lib/agents";
import type { AvailableDocuments } from "@/types";

type RunsStream = typeof agentsClient.runs.stream;

async function getFocusDocumentIds(
	externalId: string,
): Promise<readonly string[]> {
	if (focusDocumentsStore.hasThread(externalId)) {
		return focusDocumentsStore.getDocuments(externalId);
	}

	try {
		const thread = await agentsClient.threads.get(externalId);
		const docIds = readFocusDocuments(thread);
		focusDocumentsStore.setDocuments(externalId, docIds);
		return docIds;
	} catch {
		return focusDocumentsStore.getDocuments(externalId);
	}
}

/**
 * Runtime client wrapper that injects private document context into every graph
 * run without leaking that bookkeeping into chat UI components.
 */
export function createDocumentScopedClient(
	availableDocuments: AvailableDocuments,
) {
	const normalizedAvailableDocuments =
		normalizeAvailableDocuments(availableDocuments);

	return {
		runs: {
			stream: (async (
				threadId: string | null,
				assistantId: string,
				payload?: unknown,
			) => {
				const focusDocumentIds =
					typeof threadId === "string"
						? await getFocusDocumentIds(threadId)
						: [];
				const payloadRecord = parseUnknownRecord(payload);
				const context = parseUnknownRecord(payloadRecord.context);
				const scopedPayload = {
					...payloadRecord,
					context: {
						...context,
						[FOCUS_DOCUMENTS_KEY]: [...focusDocumentIds],
						[AVAILABLE_DOCUMENTS_KEY]:
							normalizedAvailableDocuments === "all"
								? "all"
								: [...normalizedAvailableDocuments],
					},
				} as never;

				return threadId === null
					? agentsClient.runs.stream(null, assistantId, scopedPayload)
					: agentsClient.runs.stream(threadId, assistantId, scopedPayload);
			}) as unknown as RunsStream,
		},
	};
}
