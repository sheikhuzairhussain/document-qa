"use client";

import { useAuiState } from "@assistant-ui/react";
import type { FC } from "react";
import {
	EMPTY_THREAD_COMPONENTS,
	isNewChatView,
	ThreadComponentsContext,
	type ThreadProps,
} from "./thread-components-context";
import { ThreadRoot } from "./thread-root";

export type {
	ThreadComponents,
	ThreadGroupPart,
	ThreadProps,
} from "./thread-components-context";

export const Thread: FC<ThreadProps> = ({
	availableDocuments,
	components = EMPTY_THREAD_COMPONENTS,
}) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadRoot isEmpty={isEmpty} availableDocuments={availableDocuments} />
		</ThreadComponentsContext.Provider>
	);
};
