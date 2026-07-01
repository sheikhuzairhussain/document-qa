import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	unstable_createLangGraphStream,
	useLangGraphRuntime,
} from "@assistant-ui/react-langgraph";
import { type PropsWithChildren, useMemo } from "react";
import { useSetActiveThreadId } from "@/features/chat/active-thread-context";
import { createDocumentScopedClient } from "@/features/chat/document-scoped-client";
import { langGraphThreadListAdapter } from "@/features/chat/langgraph-thread-list-adapter";
import { loadThread } from "@/features/chat/thread-loader";
import { ASSISTANT_ID } from "@/lib/agents";
import type { AvailableDocuments } from "@/types";

/**
 * Provides the assistant-ui runtime backed by the Aegra agents container.
 * Conversations are Aegra threads (via {@link langGraphThreadListAdapter}) and
 * assistant responses stream from the `qa-agent` LangGraph graph.
 */
export function AgentRuntimeProvider({
	availableDocuments,
	children,
}: PropsWithChildren<{ availableDocuments: AvailableDocuments }>) {
	const setActiveThreadId = useSetActiveThreadId();
	const streamMessages = useMemo(
		() =>
			unstable_createLangGraphStream({
				client: createDocumentScopedClient(availableDocuments),
				assistantId: ASSISTANT_ID,
			}),
		[availableDocuments],
	);

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
			{children}
		</AssistantRuntimeProvider>
	);
}
