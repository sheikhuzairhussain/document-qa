import { ASSISTANT_ID, agentsClient } from "@/lib/agents";
import {
	AVAILABLE_DOCUMENTS_KEY,
	FOCUS_DOCUMENTS_KEY,
	focusDocumentsStore,
	readFocusDocuments,
} from "@/lib/focus-documents";
import { langGraphThreadListAdapter } from "@/lib/langgraph-thread-list-adapter";
import { getAvailableDocuments } from "@/lib/rag-selection";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	type LangChainMessage,
	unstable_createLangGraphStream,
	useLangGraphRuntime,
} from "@assistant-ui/react-langgraph";
import {
	type PropsWithChildren,
	createContext,
	useContext,
	useState,
} from "react";

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
 * `stream` callback for the runtime: initializes (creates, if new) the Aegra
 * thread, then runs the `qa-agent` graph, streaming `messages`/`updates`/
 * `custom` events back to assistant-ui.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

type RunsStream = typeof agentsClient.runs.stream;

const documentScopedClient = {
	runs: {
		stream: (async (
			threadId: string | null,
			assistantId: string,
			payload?: unknown,
		) => {
			const focusDocumentIds =
				typeof threadId === "string" ? await getFocusDocumentIds(threadId) : [];
			const availableDocuments = getAvailableDocuments() ?? [
				...focusDocumentIds,
			];
			const payloadRecord = isRecord(payload) ? payload : {};
			const context = isRecord(payloadRecord.context)
				? payloadRecord.context
				: {};
			const scopedPayload = {
				...payloadRecord,
				context: {
					...context,
					[FOCUS_DOCUMENTS_KEY]: [...focusDocumentIds],
					[AVAILABLE_DOCUMENTS_KEY]:
						availableDocuments === "all" ? "all" : [...availableDocuments],
				},
			} as never;
			return threadId === null
				? agentsClient.runs.stream(null, assistantId, scopedPayload)
				: agentsClient.runs.stream(threadId, assistantId, scopedPayload);
		}) as unknown as RunsStream,
	},
};

const streamMessages = unstable_createLangGraphStream({
	client: documentScopedClient,
	assistantId: ASSISTANT_ID,
});

/** Loads an existing Aegra thread's message history when the user switches to
 * it. Messages live under `state.values.messages` in the graph state. */
async function loadThread(externalId: string) {
	const state = await agentsClient.threads.getState(externalId);
	const values = state.values as { messages?: LangChainMessage[] } | null;
	return { messages: values?.messages ?? [] };
}

const ActiveThreadContext = createContext<string | null>(null);

/**
 * The Aegra `thread_id` of the active chat, or `null` for a brand-new thread
 * that hasn't been initialized yet (i.e. before the first message is sent).
 * Document scoping keys off this so uploads land on the current chat.
 */
export function useActiveThreadId(): string | null {
	return useContext(ActiveThreadContext);
}

/**
 * Provides the assistant-ui runtime backed by the Aegra agents container.
 * Conversations are Aegra threads (via {@link langGraphThreadListAdapter}) and
 * assistant responses stream from the `qa-agent` LangGraph graph.
 */
export function AgentRuntimeProvider({ children }: PropsWithChildren) {
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

	const runtime = useLangGraphRuntime({
		stream: streamMessages,
		load: loadThread,
		unstable_threadListAdapter: langGraphThreadListAdapter,
		unstable_allowCancellation: true,
		// Emits the settled remote id when switching/initializing threads
		// (`undefined` while a freshly created thread is still optimistic).
		onThreadIdChange: (id) => setActiveThreadId(id ?? null),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ActiveThreadContext.Provider value={activeThreadId}>
				{children}
			</ActiveThreadContext.Provider>
		</AssistantRuntimeProvider>
	);
}
