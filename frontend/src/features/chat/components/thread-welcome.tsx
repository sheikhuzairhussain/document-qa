import { SuggestionPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { FileSearchIcon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";

export const ThreadWelcome: FC = () => {
	return (
		<div className="aui-thread-welcome-root fade-in animate-in fill-mode-both mb-8 flex flex-col items-center px-4 text-center duration-300">
			<div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
				<FileSearchIcon className="size-6" />
			</div>
			<h2 className="text-xl font-semibold tracking-tight text-neutral-900">
				Start with your PDFs
			</h2>
			<p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
				Upload to focus for this chat, or keep files in the library and choose
				which ones are searchable. You can also drop a document into the
				workspace.
			</p>
		</div>
	);
};

export const ThreadSuggestions: FC = () => {
	return (
		<div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-4">
			<ThreadPrimitive.Suggestions>
				{() => <ThreadSuggestionItem />}
			</ThreadPrimitive.Suggestions>
		</div>
	);
};

const ThreadSuggestionItem: FC = () => {
	return (
		<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
			<SuggestionPrimitive.Trigger send asChild>
				<Button
					variant="ghost"
					className="aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors"
				>
					<SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
					<SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
				</Button>
			</SuggestionPrimitive.Trigger>
		</div>
	);
};
