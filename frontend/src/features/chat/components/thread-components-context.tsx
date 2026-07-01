import type {
	AssistantState,
	MessagePrimitive,
	ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
	type ComponentType,
	createContext,
	type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups.
 */
export type ThreadComponents = {
	AssistantMessage?: ComponentType | undefined;
	Welcome?: ComponentType | undefined;
	ToolFallback?: ToolCallMessagePartComponent | undefined;
	ToolGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
	ReasoningGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
};

export type ThreadProps = {
	components?: ThreadComponents | undefined;
};

export const EMPTY_THREAD_COMPONENTS: ThreadComponents = {};

export const ThreadComponentsContext = createContext<ThreadComponents>(
	EMPTY_THREAD_COMPONENTS,
);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
export const isNewChatView = (s: AssistantState) =>
	s.thread.messages.length === 0 &&
	(!s.thread.isLoading || s.threads.isLoading);
