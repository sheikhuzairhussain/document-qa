import { create } from "zustand";

type ChatSessionState = {
	activeThreadId: string | null;
	setActiveThreadId: (threadId: string | null) => void;
};

const useChatSessionStore = create<ChatSessionState>((set) => ({
	activeThreadId: null,
	setActiveThreadId: (threadId) => set({ activeThreadId: threadId }),
}));

/**
 * The Aegra `thread_id` of the active chat, or `null` for a brand-new thread
 * that has not been initialized yet.
 */
export function useActiveThreadId(): string | null {
	return useChatSessionStore((state) => state.activeThreadId);
}

export function useSetActiveThreadId() {
	return useChatSessionStore((state) => state.setActiveThreadId);
}
