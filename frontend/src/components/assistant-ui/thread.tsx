"use client";

import { usePdfViewer } from "@/components/PdfViewer";
import {
	ComposerAttachments,
	UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
	Reasoning,
	ReasoningContent,
	ReasoningRoot,
	ReasoningText,
	ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useDocumentsContext } from "@/components/documents-context";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	type DocumentSourceChunk,
	extractDocumentSourcesFromParts,
	extractSourceChunksFromArtifact,
} from "@/lib/citations";
import { getPdfFiles } from "@/lib/files";
import { cn } from "@/lib/utils";
import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	type AssistantState,
	AuiIf,
	BranchPickerPrimitive,
	ComposerPrimitive,
	ErrorPrimitive,
	MessagePrimitive,
	SuggestionPrimitive,
	ThreadPrimitive,
	type ToolCallMessagePart,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
	groupPartByType,
	useAuiState,
} from "@assistant-ui/react";
import {
	ArrowDownIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	FileSearchIcon,
	FileTextIcon,
	MoreHorizontalIcon,
	PaperclipIcon,
	PencilIcon,
	RefreshCwIcon,
	SendHorizontalIcon,
	SquareIcon,
} from "lucide-react";
import {
	type ComponentType,
	type FC,
	type PropsWithChildren,
	createContext,
	useContext,
	useMemo,
	useRef,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
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

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
	createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
	s.thread.messages.length === 0 &&
	(!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadRoot isEmpty={isEmpty} />
		</ThreadComponentsContext.Provider>
	);
};

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
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

			{/* Composer floats at the bottom of the chat area — no surrounding bar. */}
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

const ThreadMessage: FC = () => {
	const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
		useContext(ThreadComponentsContext);
	const role = useAuiState((s) => s.message.role);
	const isEditing = useAuiState((s) => s.message.composer.isEditing);

	if (isEditing) return <EditComposer />;
	if (role === "user") return <UserMessage />;
	return <AssistantMessageComponent />;
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

const ThreadWelcome: FC = () => {
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
				which ones are searchable.
			</p>
		</div>
	);
};

const ThreadSuggestions: FC = () => {
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

const Composer: FC = () => {
	return (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col gap-2">
			<ComposerAttachments />
			<ComposerPrimitive.AttachmentDropzone asChild>
				<div
					data-slot="aui_composer-shell"
					className="border-border data-[dragging=true]:border-ring focus-within:border-ring/60 flex w-full items-center gap-1 rounded-xl border bg-muted/40 px-1.5 py-1.5 shadow-sm transition-colors focus-within:bg-background data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/40"
				>
					<ComposerUpload />
					<ComposerPrimitive.Input
						placeholder="Ask about your selected documents..."
						className="aui-composer-input placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed outline-none"
						rows={1}
						autoFocus
						aria-label="Message input"
					/>
					<ComposerSend />
				</div>
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
};

const ComposerUpload: FC = () => {
	const { uploading, upload } = useDocumentsContext();
	const inputRef = useRef<HTMLInputElement>(null);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		for (const file of getPdfFiles(e.target.files)) {
			void upload(file);
		}
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept="application/pdf,.pdf"
				multiple
				className="hidden"
				onChange={handleChange}
			/>
			<TooltipIconButton
				tooltip="Upload to focus documents"
				side="top"
				type="button"
				variant="ghost"
				size="icon"
				className="aui-composer-upload text-muted-foreground hover:text-foreground size-8 shrink-0"
				aria-label="Upload to focus documents"
				disabled={uploading}
				onClick={() => inputRef.current?.click()}
			>
				<PaperclipIcon className="size-4" />
			</TooltipIconButton>
		</>
	);
};

const ComposerSend: FC = () => {
	return (
		<>
			<AuiIf condition={(s) => !s.thread.isRunning}>
				<ComposerPrimitive.Send asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-send text-foreground disabled:text-muted-foreground/40 size-8 shrink-0"
						aria-label="Send message"
					>
						<SendHorizontalIcon className="size-4" />
					</Button>
				</ComposerPrimitive.Send>
			</AuiIf>
			<AuiIf condition={(s) => s.thread.isRunning}>
				<ComposerPrimitive.Cancel asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-cancel text-foreground size-8 shrink-0"
						aria-label="Stop generating"
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
					</Button>
				</ComposerPrimitive.Cancel>
			</AuiIf>
		</>
	);
};

const MessageError: FC = () => {
	return (
		<MessagePrimitive.Error>
			<ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
				<ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
			</ErrorPrimitive.Root>
		</MessagePrimitive.Error>
	);
};

const AssistantMessage: FC = () => {
	const {
		ToolFallback: ToolFallbackComponent = ToolFallback,
		ToolGroup,
		ReasoningGroup,
	} = useContext(ThreadComponentsContext);

	// reserves space for action bar and compensates with `-mb` for consistent msg spacing
	// keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
	// for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
	const ACTION_BAR_PT = "pt-1.5";
	const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
		>
			<div
				data-slot="aui_assistant-message-content"
				// [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
				className="text-foreground wrap-break-word px-2 text-sm leading-6 [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
			>
				<MessagePrimitive.GroupedParts
					groupBy={groupPartByType({
						reasoning: ["group-chainOfThought", "group-reasoning"],
						"tool-call": ["group-chainOfThought", "group-tool"],
						"standalone-tool-call": [],
					})}
				>
					{({ part, children }) => {
						switch (part.type) {
							case "group-chainOfThought":
								return <div data-slot="aui_chain-of-thought">{children}</div>;
							case "group-tool":
								if (ToolGroup) {
									return <ToolGroup group={part}>{children}</ToolGroup>;
								}
								return (
									<DocumentToolGroup group={part}>{children}</DocumentToolGroup>
								);
							case "group-reasoning": {
								if (ReasoningGroup) {
									return (
										<ReasoningGroup group={part}>{children}</ReasoningGroup>
									);
								}
								const running = part.status.type === "running";
								return (
									<ReasoningRoot streaming={running}>
										<ReasoningTrigger active={running} />
										<ReasoningContent aria-busy={running}>
											<ReasoningText>{children}</ReasoningText>
										</ReasoningContent>
									</ReasoningRoot>
								);
							}
							case "text":
								return <MarkdownText />;
							case "reasoning":
								return <Reasoning {...part} />;
							case "tool-call":
								return (
									part.toolUI ?? (
										<DocumentToolCall
											{...part}
											Fallback={ToolFallbackComponent}
										/>
									)
								);
							case "data":
								return part.dataRendererUI;
							case "indicator":
								return (
									<span
										data-slot="aui_assistant-message-indicator"
										className="animate-pulse font-sans"
										aria-label="Assistant is working"
									>
										{"●"}
									</span>
								);
							default:
								return null;
						}
					}}
				</MessagePrimitive.GroupedParts>
				<MessageError />
				<AssistantSources />
			</div>

			<div
				data-slot="aui_assistant-message-footer"
				className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
			>
				<BranchPicker />
				<AssistantActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};

type DocumentToolCallProps = ToolCallMessagePartProps & {
	Fallback: ToolCallMessagePartComponent;
};

type DocumentToolPart = ToolCallMessagePart & {
	status: ToolCallMessagePartProps["status"];
};

type DocumentToolName = "search_documents" | "read_document";

type SearchPageTarget = {
	key: string;
	documentId: string;
	filename: string;
	pageNo: number;
	pageLabel: string;
};

const DOCUMENT_TOOL_LABELS = {
	search_documents: {
		running: "Searching documents...",
		complete: "Searched documents",
		error: "Document search failed",
	},
	read_document: {
		running: "Reading focus document...",
		complete: "Read focus document",
		error: "Focus document read failed",
	},
} as const;

const DocumentToolGroup: FC<
	PropsWithChildren<{
		group: ThreadGroupPart;
	}>
> = ({ group, children }) => {
	const messageParts = useAuiState((s) => s.message.parts);
	const toolParts = group.indices
		.map((index) => messageParts[index])
		.filter(isToolCallPart);

	if (
		toolParts.length !== group.indices.length ||
		toolParts.some((part) => !isDocumentToolName(part.toolName))
	) {
		return (
			<div
				data-slot="aui_document-tool-stack"
				className="my-2 flex flex-col gap-1.5"
			>
				{children}
			</div>
		);
	}

	const runs = getDocumentToolRuns(toolParts);

	return (
		<div
			data-slot="aui_document-tool-stack"
			className="my-2 flex flex-col gap-1.5"
		>
			{runs.map((run) => {
				if (run.toolName === "search_documents") {
					return <DocumentSearchToolRun key={run.key} parts={run.parts} />;
				}

				return run.parts.map((part) => (
					<DocumentReadToolRow key={part.toolCallId} part={part} />
				));
			})}
		</div>
	);
};

const DocumentToolCall: FC<DocumentToolCallProps> = ({
	Fallback,
	toolName,
	status,
	artifact,
	...props
}) => {
	if (!isDocumentToolName(toolName)) {
		return (
			<Fallback
				toolName={toolName}
				status={status}
				artifact={artifact}
				{...props}
			/>
		);
	}

	const part = { toolName, status, artifact, ...props } as DocumentToolPart;
	if (toolName === "search_documents") {
		return <DocumentSearchToolRun parts={[part]} />;
	}

	return <DocumentReadToolRow part={part} />;
};

const DocumentSearchToolRun: FC<{ parts: readonly DocumentToolPart[] }> = ({
	parts,
}) => {
	const chunks = parts.flatMap((part) =>
		extractSourceChunksFromArtifact(part.artifact),
	);
	const status = getToolRunStatus(parts);
	const isRunning =
		status.type === "running" || status.type === "requires-action";
	const isError = status.type === "incomplete" && status.reason !== "cancelled";
	const labels = DOCUMENT_TOOL_LABELS.search_documents;
	const label = isRunning
		? labels.running
		: isError
			? labels.error
			: labels.complete;
	const { openDocument } = usePdfViewer();
	const pageTargets = useMemo(() => getSearchPageTargets(chunks), [chunks]);

	return (
		<Collapsible data-slot="aui-document-search-tool" className="group/search">
			<CollapsibleTrigger
				className={cn(documentToolRowClassName, "cursor-pointer")}
			>
				<DocumentToolRowIcon Icon={FileSearchIcon} />
				<DocumentToolLabel label={label} running={isRunning} />
				{!isRunning && (
					<span className="text-muted-foreground/70 ms-auto shrink-0 text-[11px]">
						{formatResultCount(pageTargets.length)}
					</span>
				)}
				<ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/search:rotate-180" />
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden">
				<div className="border-border/40 bg-muted/10 mt-1 rounded-md border px-2 py-1.5">
					{pageTargets.length > 0 ? (
						<div className="flex flex-col gap-1">
							{pageTargets.map((page) => (
								<button
									key={page.key}
									type="button"
									className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] transition-colors"
									onClick={() =>
										openDocument({
											documentId: page.documentId,
											filename: page.filename,
											pageNo: page.pageNo,
										})
									}
								>
									<FileTextIcon className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">
										{page.filename}
									</span>
									<span className="shrink-0 tabular-nums">
										{page.pageLabel}
									</span>
								</button>
							))}
						</div>
					) : (
						<p className="text-muted-foreground/70 px-1.5 py-1 text-[11px]">
							No pages returned.
						</p>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

const DocumentReadToolRow: FC<{ part: DocumentToolPart }> = ({ part }) => {
	const chunks = extractSourceChunksFromArtifact(part.artifact);
	const isRunning =
		part.status.type === "running" || part.status.type === "requires-action";
	const isError =
		part.status.type === "incomplete" && part.status.reason !== "cancelled";
	const labels = DOCUMENT_TOOL_LABELS.read_document;
	const label = isRunning
		? labels.running
		: isError
			? labels.error
			: labels.complete;
	const focusTarget = chunks[0] ?? null;
	const { openDocument } = usePdfViewer();

	return (
		<button
			type="button"
			data-slot="aui-document-tool-row"
			className={cn(
				documentToolRowClassName,
				"disabled:pointer-events-none disabled:opacity-70",
			)}
			disabled={!focusTarget}
			onClick={() => {
				if (!focusTarget) return;
				openDocument({
					documentId: focusTarget.document_id,
					filename: focusTarget.filename,
				});
			}}
		>
			<DocumentToolRowIcon Icon={FileTextIcon} />
			<DocumentToolLabel label={label} running={isRunning} />
			{focusTarget && (
				<span className="text-muted-foreground/70 ms-auto min-w-0 max-w-48 truncate text-[11px]">
					{focusTarget.filename}
				</span>
			)}
		</button>
	);
};

const documentToolRowClassName =
	"border-border/50 bg-muted/25 text-muted-foreground flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors";

const DocumentToolRowIcon: FC<{ Icon: typeof FileSearchIcon }> = ({ Icon }) => {
	return (
		<span className="border-border/50 bg-background flex size-6 shrink-0 items-center justify-center rounded-md border">
			<Icon className="size-3.5" />
		</span>
	);
};

const DocumentToolLabel: FC<{ label: string; running: boolean }> = ({
	label,
	running,
}) => {
	return (
		<span className="relative inline-block min-w-0 text-start leading-none font-medium">
			<span className="block truncate">{label}</span>
			{running && (
				<span
					aria-hidden
					className="shimmer pointer-events-none absolute inset-0 block truncate motion-reduce:animate-none"
				>
					{label}
				</span>
			)}
		</span>
	);
};

function getSearchPageTargets(
	chunks: readonly DocumentSourceChunk[],
): SearchPageTarget[] {
	const byPage = new Map<string, SearchPageTarget>();

	for (const chunk of chunks) {
		if (chunk.page_no === null) continue;
		const key = `${chunk.document_id}:${chunk.page_no}`;
		if (byPage.has(key)) continue;
		byPage.set(key, {
			key,
			documentId: chunk.document_id,
			filename: chunk.filename,
			pageNo: chunk.page_no,
			pageLabel: `p. ${chunk.page_no}`,
		});
	}

	return [...byPage.values()].sort((a, b) => {
		const pageOrder = a.pageNo - b.pageNo;
		if (pageOrder !== 0) return pageOrder;
		return a.filename.localeCompare(b.filename);
	});
}

function formatResultCount(count: number): string {
	return `${count} result${count === 1 ? "" : "s"}`;
}

function isToolCallPart(value: unknown): value is DocumentToolPart {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "tool-call" &&
		"toolName" in value &&
		typeof value.toolName === "string" &&
		"status" in value &&
		typeof value.status === "object" &&
		value.status !== null
	);
}

function isDocumentToolName(toolName: string): toolName is DocumentToolName {
	return toolName === "search_documents" || toolName === "read_document";
}

function getToolRunStatus(parts: readonly DocumentToolPart[]) {
	if (
		parts.some(
			(part) =>
				part.status.type === "running" ||
				part.status.type === "requires-action",
		)
	) {
		return { type: "running" } as const;
	}

	const failed = parts.find(
		(part) =>
			part.status.type === "incomplete" && part.status.reason !== "cancelled",
	);
	if (failed) return failed.status;

	return parts.at(-1)?.status ?? ({ type: "complete" } as const);
}

function getDocumentToolRuns(parts: readonly DocumentToolPart[]) {
	const runs: {
		key: string;
		toolName: DocumentToolName;
		parts: DocumentToolPart[];
	}[] = [];

	for (const part of parts) {
		if (!isDocumentToolName(part.toolName)) continue;
		const previous = runs.at(-1);
		if (
			previous &&
			previous.toolName === part.toolName &&
			part.toolName === "search_documents"
		) {
			previous.parts.push(part);
			continue;
		}

		runs.push({
			key: part.toolCallId,
			toolName: part.toolName,
			parts: [part],
		});
	}

	return runs;
}

const AssistantSources: FC = () => {
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
			<span className="text-muted-foreground mr-0.5 text-[11px] font-medium">
				Sources
			</span>
			{sources.map((source) => (
				<button
					key={source.id}
					type="button"
					data-source-type={source.sourceType}
					className="border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:bg-muted inline-flex h-6 max-w-48 items-center gap-1.5 rounded-md border px-2 text-[11px] leading-none transition-colors"
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

const AssistantActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="not-last"
			className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
		>
			<ActionBarPrimitive.Copy asChild>
				<TooltipIconButton tooltip="Copy">
					<AuiIf condition={(s) => s.message.isCopied}>
						<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
					</AuiIf>
					<AuiIf condition={(s) => !s.message.isCopied}>
						<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
					</AuiIf>
				</TooltipIconButton>
			</ActionBarPrimitive.Copy>
			<ActionBarPrimitive.Reload asChild>
				<TooltipIconButton tooltip="Refresh">
					<RefreshCwIcon />
				</TooltipIconButton>
			</ActionBarPrimitive.Reload>
			<ActionBarMorePrimitive.Root>
				<ActionBarMorePrimitive.Trigger asChild>
					<TooltipIconButton
						tooltip="More"
						className="data-[state=open]:bg-accent"
					>
						<MoreHorizontalIcon />
					</TooltipIconButton>
				</ActionBarMorePrimitive.Trigger>
				<ActionBarMorePrimitive.Content
					side="bottom"
					align="start"
					sideOffset={6}
					className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
				>
					<ActionBarPrimitive.ExportMarkdown asChild>
						<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
							<DownloadIcon className="size-4" />
							Export as Markdown
						</ActionBarMorePrimitive.Item>
					</ActionBarPrimitive.ExportMarkdown>
				</ActionBarMorePrimitive.Content>
			</ActionBarMorePrimitive.Root>
		</ActionBarPrimitive.Root>
	);
};

const UserMessage: FC = () => {
	return (
		<MessagePrimitive.Root
			data-slot="aui_user-message-root"
			className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
			data-role="user"
		>
			<UserMessageAttachments />

			<div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
				<div className="aui-user-message-content peer bg-muted text-foreground wrap-break-word rounded-xl px-3 py-1.5 text-sm leading-6 empty:hidden">
					<MessagePrimitive.Parts />
				</div>
				<div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
					<UserActionBar />
				</div>
			</div>

			<BranchPicker
				data-slot="aui_user-branch-picker"
				className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
			/>
		</MessagePrimitive.Root>
	);
};

const UserActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="not-last"
			className="aui-user-action-bar-root flex flex-col items-end"
		>
			<ActionBarPrimitive.Edit asChild>
				<TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
					<PencilIcon />
				</TooltipIconButton>
			</ActionBarPrimitive.Edit>
		</ActionBarPrimitive.Root>
	);
};

const EditComposer: FC = () => {
	return (
		<MessagePrimitive.Root
			data-slot="aui_edit-composer-wrapper"
			className="flex flex-col px-2"
		>
			<ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
				<ComposerPrimitive.Input
					className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-sm leading-6 outline-none"
					autoFocus
				/>
				<div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
					<ComposerPrimitive.Cancel asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 rounded-full px-3.5"
						>
							Cancel
						</Button>
					</ComposerPrimitive.Cancel>
					<ComposerPrimitive.Send asChild>
						<Button size="sm" className="h-8 rounded-full px-3.5">
							Update
						</Button>
					</ComposerPrimitive.Send>
				</div>
			</ComposerPrimitive.Root>
		</MessagePrimitive.Root>
	);
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
	className,
	...rest
}) => {
	return (
		<BranchPickerPrimitive.Root
			hideWhenSingleBranch
			className={cn(
				"aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
				className,
			)}
			{...rest}
		>
			<BranchPickerPrimitive.Previous asChild>
				<TooltipIconButton tooltip="Previous">
					<ChevronLeftIcon />
				</TooltipIconButton>
			</BranchPickerPrimitive.Previous>
			<span className="aui-branch-picker-state font-medium">
				<BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
			</span>
			<BranchPickerPrimitive.Next asChild>
				<TooltipIconButton tooltip="Next">
					<ChevronRightIcon />
				</TooltipIconButton>
			</BranchPickerPrimitive.Next>
		</BranchPickerPrimitive.Root>
	);
};
