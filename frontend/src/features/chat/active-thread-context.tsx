import {
	createContext,
	type PropsWithChildren,
	useContext,
	useState,
} from "react";

const ActiveThreadContext = createContext<string | null>(null);
const SetActiveThreadContext = createContext<
	((threadId: string | null) => void) | null
>(null);

export function ActiveThreadProvider({ children }: PropsWithChildren) {
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

	return (
		<ActiveThreadContext.Provider value={activeThreadId}>
			<SetActiveThreadContext.Provider value={setActiveThreadId}>
				{children}
			</SetActiveThreadContext.Provider>
		</ActiveThreadContext.Provider>
	);
}

/**
 * The Aegra `thread_id` of the active chat, or `null` for a brand-new thread
 * that has not been initialized yet.
 */
export function useActiveThreadId(): string | null {
	return useContext(ActiveThreadContext);
}

export function useSetActiveThreadId() {
	const setActiveThreadId = useContext(SetActiveThreadContext);
	if (!setActiveThreadId) {
		throw new Error(
			"useSetActiveThreadId must be used within ActiveThreadProvider",
		);
	}
	return setActiveThreadId;
}
