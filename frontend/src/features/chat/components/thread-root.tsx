import {
	type AssistantState,
	AuiIf,
	ThreadPrimitive,
	useAuiState,
	useThreadViewport,
} from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { type FC, useContext, useLayoutEffect } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import type { AvailableDocuments } from "@/types";
import { Composer } from "./composer";
import {
	isNewChatView,
	ThreadComponentsContext,
} from "./thread-components-context";
import { ThreadMessage } from "./thread-messages";
import { ThreadSuggestions, ThreadWelcome } from "./thread-welcome";

export const ThreadRoot: FC<{
	isEmpty: boolean;
	availableDocuments: AvailableDocuments;
}> = ({ isEmpty, availableDocuments }) => {
	const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);

	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
			style={{
				["--thread-max-width" as string]: "44rem",
				["--composer-bg" as string]:
					"color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
				["--composer-radius" as string]: "1.5rem",
				["--composer-padding" as string]: "8px",
			}}
		>
			<ThreadPrimitive.Viewport
				autoScroll
				turnAnchor="bottom"
				data-slot="aui_thread-viewport"
				className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto"
			>
				<ThreadBottomAnchor />
				<div
					className={cn(
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 py-4",
						isEmpty && "justify-center",
					)}
				>
					<AuiIf condition={isNewChatView}>
						<Welcome />
					</AuiIf>

					<div
						data-slot="aui_message-group"
						className="flex flex-col gap-y-5 empty:hidden"
					>
						<ThreadPrimitive.Messages>
							{() => <ThreadMessage />}
						</ThreadPrimitive.Messages>
					</div>
				</div>
			</ThreadPrimitive.Viewport>

			<div data-slot="aui_thread-composer-dock" className="relative shrink-0">
				<ThreadScrollToBottom />
				<div className="mx-auto w-full max-w-(--thread-max-width) px-4 pt-2 pb-4">
					<AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
						<ThreadSuggestions />
					</AuiIf>
					<Composer availableDocuments={availableDocuments} />
				</div>
			</div>
		</ThreadPrimitive.Root>
	);
};

const ThreadBottomAnchor: FC = () => {
	const scrollToBottom = useThreadViewport((s) => s.scrollToBottom);
	const anchorKey = useAuiState(selectBottomAnchorKey);

	useLayoutEffect(() => {
		if (anchorKey === "empty") return;

		scrollToBottom({ behavior: "instant" });
		const frame = requestAnimationFrame(() => {
			scrollToBottom({ behavior: "instant" });
		});

		return () => cancelAnimationFrame(frame);
	}, [anchorKey, scrollToBottom]);

	return null;
};

const ThreadScrollToBottom: FC = () => {
	return (
		<ThreadPrimitive.ScrollToBottom asChild>
			<TooltipIconButton
				tooltip="Scroll to bottom"
				variant="outline"
				className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full p-4 shadow-sm disabled:invisible"
			>
				<ArrowDownIcon />
			</TooltipIconButton>
		</ThreadPrimitive.ScrollToBottom>
	);
};

type ThreadPartState =
	AssistantState["thread"]["messages"][number]["parts"][number];

function selectBottomAnchorKey(state: AssistantState): string {
	const messages = state.thread.messages;
	const lastMessage = messages.at(-1);
	if (!lastMessage) return "empty";

	return [
		state.thread.isRunning ? "running" : "idle",
		messages.length,
		lastMessage.id,
		lastMessage.role,
		lastMessage.status?.type ?? "complete",
		lastMessage.parts.map(partBottomAnchorKey).join(","),
	].join("|");
}

function partBottomAnchorKey(part: ThreadPartState): string {
	const status = part.status.type;
	switch (part.type) {
		case "text":
		case "reasoning":
			return `${part.type}:${status}:${part.text.length}`;
		case "tool-call":
			return [
				part.type,
				status,
				part.toolCallId,
				part.toolName,
				part.argsText.length,
				part.result === undefined ? "pending" : "result",
				part.isError ? "error" : "ok",
			].join(":");
		case "source":
			return `${part.type}:${status}:${part.id}`;
		case "data":
			return `${part.type}:${status}:${part.name}`;
		default:
			return `${part.type}:${status}`;
	}
}
