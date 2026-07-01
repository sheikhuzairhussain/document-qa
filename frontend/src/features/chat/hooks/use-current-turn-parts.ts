"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo } from "react";

export function useCurrentTurnParts() {
	const messageIndex = useAuiState((s) => s.message.index);
	const threadMessages = useAuiState((s) => s.thread.messages);

	return useMemo(() => {
		let startIndex = 0;
		for (let index = messageIndex; index >= 0; index -= 1) {
			if (threadMessages[index]?.role === "user") {
				startIndex = index + 1;
				break;
			}
		}
		return threadMessages
			.slice(startIndex, messageIndex + 1)
			.flatMap((message) => message.parts);
	}, [messageIndex, threadMessages]);
}
