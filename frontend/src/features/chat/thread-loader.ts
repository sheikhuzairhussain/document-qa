import type { LangChainMessage } from "@assistant-ui/react-langgraph";
import { agentsClient } from "@/lib/agents";

/** Loads an existing Aegra thread's message history for assistant-ui. */
export async function loadThread(externalId: string) {
	const state = await agentsClient.threads.getState(externalId);
	const values = state.values as { messages?: LangChainMessage[] } | null;
	return { messages: values?.messages ?? [] };
}
