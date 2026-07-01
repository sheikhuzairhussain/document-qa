import type {
	RemoteThreadListAdapter,
	ThreadMessage,
} from "@assistant-ui/react";
import type { Thread } from "@langchain/langgraph-sdk";
import { createAssistantStream } from "assistant-stream";
import {
	focusDocumentsMetadata,
	focusDocumentsStore,
	updateThreadMetadata,
} from "@/features/focus-documents/focus-documents-store";
import { agentsClient } from "@/lib/agents";

/** Aegra/LangGraph threads have no native title or archive flag, so we stash
 * both in thread metadata under these keys. */
const TITLE_KEY = "title";
const STATUS_KEY = "aui_status";
const MAX_TITLE_LENGTH = 60;

function readTitle(thread: Thread): string | undefined {
	const value = thread.metadata?.[TITLE_KEY];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toMetadata(thread: Thread) {
	const archived = thread.metadata?.[STATUS_KEY] === "archived";
	return {
		status: archived ? ("archived" as const) : ("regular" as const),
		remoteId: thread.thread_id,
		externalId: thread.thread_id,
		title: readTitle(thread),
		lastMessageAt: new Date(thread.updated_at),
	};
}

function firstUserText(messages: readonly ThreadMessage[]): string {
	for (const message of messages) {
		if (message.role !== "user") continue;
		const parts: string[] = [];
		for (const part of message.content) {
			if (part.type === "text") parts.push(part.text);
		}
		const text = parts.join(" ").trim();
		if (text) return text;
	}
	return "";
}

/**
 * Backs assistant-ui's thread list with Aegra's own thread store, so existing
 * LangGraph threads show up in the sidebar and can be created, renamed,
 * archived, and deleted directly against Aegra — no assistant-cloud involved.
 * The `externalId` we return is the LangGraph `thread_id`, which the runtime's
 * `stream`/`load` callbacks then use to run and resume the graph.
 */
export const langGraphThreadListAdapter: RemoteThreadListAdapter = {
	async list() {
		const threads = await agentsClient.threads.search({ limit: 100 });
		const sorted = [...threads].sort(
			(a, b) =>
				new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
		);
		return { threads: sorted.map(toMetadata) };
	},

	async initialize(threadId) {
		// Create the Aegra thread with the frontend-generated draft id so the
		// chat's id is stable from before the thread existed. Stamp the documents
		// marked as focus into the thread's metadata as `focus_documents`.
		const draftId = focusDocumentsStore.getDraftId();
		const thread = await agentsClient.threads.create({
			threadId: draftId,
			metadata: {
				aui_local_id: threadId,
				...focusDocumentsMetadata(focusDocumentsStore.getDocuments(draftId)),
			},
		});
		return { remoteId: thread.thread_id, externalId: thread.thread_id };
	},

	async rename(remoteId, newTitle) {
		await updateThreadMetadata(remoteId, { [TITLE_KEY]: newTitle });
	},

	async archive(remoteId) {
		await updateThreadMetadata(remoteId, { [STATUS_KEY]: "archived" });
	},

	async unarchive(remoteId) {
		await updateThreadMetadata(remoteId, { [STATUS_KEY]: "regular" });
	},

	async delete(remoteId) {
		await agentsClient.threads.delete(remoteId);
	},

	async fetch(threadId) {
		return toMetadata(await agentsClient.threads.get(threadId));
	},

	async generateTitle(remoteId, messages) {
		const source = firstUserText(messages) || "New chat";
		const title =
			source.length > MAX_TITLE_LENGTH
				? `${source.slice(0, MAX_TITLE_LENGTH - 1)}…`
				: source;
		// Persist so the title survives reloads (read back by `list`/`fetch`)...
		await updateThreadMetadata(remoteId, { [TITLE_KEY]: title });
		// ...and stream it back so the sidebar label updates immediately.
		return createAssistantStream((controller) => {
			controller.appendText(title);
		});
	},
};
