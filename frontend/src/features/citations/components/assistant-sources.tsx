"use client";

import { useAuiState } from "@assistant-ui/react";
import { FileTextIcon } from "lucide-react";
import { type FC, useMemo } from "react";
import { extractDocumentSourcesFromParts } from "@/features/citations/citations";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";

export const AssistantSources: FC = () => {
	const messageParts = useAuiState((s) => s.message.parts);
	const messageIndex = useAuiState((s) => s.message.index);
	const isMessageRunning = useAuiState(
		(s) => s.message.status?.type === "running",
	);
	const threadMessages = useAuiState((s) => s.thread.messages);
	const hasAnswerText = messageParts.some(
		(part) =>
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.trim().length > 0,
	);
	const turnParts = useMemo(() => {
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
	const sources = useMemo(
		() => extractDocumentSourcesFromParts(turnParts),
		[turnParts],
	);
	const { openDocument } = usePdfViewer();

	if (isMessageRunning || !hasAnswerText || sources.length === 0) return null;

	return (
		<div
			data-slot="aui_assistant-message-sources"
			className="mt-3 flex flex-wrap items-center gap-1.5"
		>
			<span className="text-muted-foreground mr-0.5 text-xs font-medium">
				Sources
			</span>
			{sources.map((source) => (
				<button
					key={source.id}
					type="button"
					data-source-type={source.sourceType}
					className="border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:bg-muted inline-flex h-6 max-w-48 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs leading-none transition-colors"
					title={source.filename}
					onClick={() =>
						openDocument({
							documentId: source.id,
							filename: source.filename,
						})
					}
				>
					<FileTextIcon className="size-3 shrink-0" />
					<span className="min-w-0 truncate">{source.title}</span>
				</button>
			))}
		</div>
	);
};
