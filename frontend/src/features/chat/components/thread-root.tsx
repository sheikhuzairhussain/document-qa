import { AuiIf, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { type FC, useContext } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import {
	isNewChatView,
	ThreadComponentsContext,
} from "./thread-components-context";
import { ThreadMessage } from "./thread-messages";
import { ThreadSuggestions, ThreadWelcome } from "./thread-welcome";

export const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
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
				turnAnchor="top"
				data-slot="aui_thread-viewport"
				className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
			>
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
					<Composer />
				</div>
			</div>
		</ThreadPrimitive.Root>
	);
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
