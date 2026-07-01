"use client";

import {
	type MessagePrimitive,
	type ToolCallMessagePart,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
	useAuiState,
} from "@assistant-ui/react";
import {
	BotIcon,
	ChevronDownIcon,
	DownloadIcon,
	ExternalLinkIcon,
	FilePenIcon,
	FileSearchIcon,
	FileTextIcon,
	FolderOpenIcon,
	ListTodoIcon,
	type LucideIcon,
	SaveIcon,
	SearchIcon,
	TerminalIcon,
} from "lucide-react";
import { type FC, type PropsWithChildren, useMemo } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	type DocumentSourceChunk,
	extractSandboxDownloadUrlArtifact,
	extractSourceChunksFromArtifact,
} from "@/features/citations/citations";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";
import { cn } from "@/lib/utils";

type DocumentToolCallProps = ToolCallMessagePartProps & {
	Fallback: ToolCallMessagePartComponent;
};

type DocumentToolPart = ToolCallMessagePart & {
	status: ToolCallMessagePartProps["status"];
};

type DocumentToolName =
	| "search_documents"
	| "read_document"
	| "get_download_url";

type FilesystemToolName =
	| "ls"
	| "read_file"
	| "write_file"
	| "edit_file"
	| "glob"
	| "grep"
	| "execute";

type AgentToolName =
	| DocumentToolName
	| FilesystemToolName
	| "write_todos"
	| "task";

type SearchDocumentTarget = {
	key: string;
	documentId: string;
	filename: string;
	firstPage: number;
	pages: number[];
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
	get_download_url: {
		running: "Preparing download...",
		complete: "Download ready",
		error: "Download unavailable",
	},
} as const;

const FILESYSTEM_TOOL_UI = {
	ls: {
		Icon: FolderOpenIcon,
		running: "Checking workspace...",
		complete: "Checked workspace",
		error: "Workspace check failed",
	},
	read_file: {
		Icon: FileTextIcon,
		running: "Reading workspace...",
		complete: "Read workspace",
		error: "Workspace read failed",
	},
	write_file: {
		Icon: SaveIcon,
		running: "Saving file...",
		complete: "Saved file",
		error: "File save failed",
	},
	edit_file: {
		Icon: FilePenIcon,
		running: "Updating file...",
		complete: "Updated file",
		error: "File update failed",
	},
	glob: {
		Icon: SearchIcon,
		running: "Finding files...",
		complete: "Found files",
		error: "File search failed",
	},
	grep: {
		Icon: FileSearchIcon,
		running: "Searching files...",
		complete: "Searched files",
		error: "File search failed",
	},
	execute: {
		Icon: TerminalIcon,
		running: "Running analysis...",
		complete: "Ran analysis",
		error: "Analysis failed",
	},
	write_todos: {
		Icon: ListTodoIcon,
		running: "Updating plan...",
		complete: "Updated plan",
		error: "Plan update failed",
	},
	task: {
		Icon: BotIcon,
		running: "Working in parallel...",
		complete: "Finished parallel work",
		error: "Parallel work failed",
	},
} as const satisfies Record<
	Exclude<AgentToolName, DocumentToolName>,
	{
		Icon: LucideIcon;
		running: string;
		complete: string;
		error: string;
	}
>;

export const DocumentToolGroup: FC<
	PropsWithChildren<{
		group: MessagePrimitive.GroupedParts.GroupPart;
	}>
> = ({ group, children }) => {
	const messageParts = useAuiState((s) => s.message.parts);
	const toolParts = group.indices
		.map((index) => messageParts[index])
		.filter(isToolCallPart);

	if (
		toolParts.length !== group.indices.length ||
		toolParts.some((part) => !isAgentToolName(part.toolName))
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

				if (run.toolName === "get_download_url") {
					return run.parts.map((part) => (
						<SandboxDownloadToolRow key={part.toolCallId} part={part} />
					));
				}

				if (run.toolName !== "read_document") {
					return run.parts.map((part) => (
						<GenericAgentToolRow key={part.toolCallId} part={part} />
					));
				}

				return run.parts.map((part) => (
					<DocumentReadToolRow key={part.toolCallId} part={part} />
				));
			})}
		</div>
	);
};

export const DocumentToolCall: FC<DocumentToolCallProps> = ({
	Fallback,
	toolName,
	status,
	artifact,
	...props
}) => {
	if (!isAgentToolName(toolName)) {
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

	if (toolName === "get_download_url") {
		return <SandboxDownloadToolRow part={part} />;
	}

	if (toolName !== "read_document") {
		return <GenericAgentToolRow part={part} />;
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
	const documentTargets = useMemo(
		() => getSearchDocumentTargets(chunks),
		[chunks],
	);
	const resultCount = documentTargets.reduce(
		(count, target) => count + target.pages.length,
		0,
	);

	return (
		<Collapsible data-slot="aui-document-search-tool" className="group/search">
			<CollapsibleTrigger
				className={cn(flatToolRowClassName, interactiveFlatToolRowClassName)}
			>
				<DocumentToolLabel label={label} running={isRunning} />
				{!isRunning && (
					<span className="text-muted-foreground/70 ms-auto shrink-0 text-xs">
						{formatResultCount(resultCount)}
					</span>
				)}
				<ChevronDownIcon
					className={cn(
						"text-muted-foreground/70 size-3.5 shrink-0 transition-transform group-data-[state=open]/search:rotate-180",
						isRunning ? "ms-auto" : "ms-0.5",
					)}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden">
				<div className="mt-0.5 flex flex-col gap-0.5">
					{documentTargets.length > 0 ? (
						<div className="flex flex-col gap-0.5">
							{documentTargets.map((target) => (
								<button
									key={target.key}
									type="button"
									className="text-muted-foreground/80 hover:text-foreground focus-visible:ring-ring/35 flex w-full cursor-pointer items-center gap-2 rounded-sm py-0.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
									onClick={() =>
										openDocument({
											documentId: target.documentId,
											filename: target.filename,
											pageNo: target.firstPage,
										})
									}
								>
									<span className="min-w-0 flex-1 truncate">
										{target.filename}
									</span>
									<span className="shrink-0 tabular-nums">
										{target.pageLabel}
									</span>
								</button>
							))}
						</div>
					) : (
						<p className="text-muted-foreground/70 py-0.5 text-xs">
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
				flatToolRowClassName,
				focusTarget && interactiveFlatToolRowClassName,
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
				<span className="text-muted-foreground/70 ms-auto min-w-0 max-w-48 truncate text-xs">
					{focusTarget.filename}
				</span>
			)}
		</button>
	);
};

const SandboxDownloadToolRow: FC<{ part: DocumentToolPart }> = ({ part }) => {
	const artifact = extractSandboxDownloadUrlArtifact(part.artifact);
	const isRunning =
		part.status.type === "running" || part.status.type === "requires-action";
	if (!isRunning && artifact?.url) return null;

	const isError =
		(part.status.type === "incomplete" && part.status.reason !== "cancelled") ||
		(!isRunning && (artifact?.error ?? null) !== null);
	const labels = DOCUMENT_TOOL_LABELS.get_download_url;
	const label = isRunning
		? labels.running
		: isError
			? labels.error
			: labels.complete;
	const content = (
		<>
			<BoxedToolRowIcon Icon={DownloadIcon} />
			<DocumentToolLabel label={label} running={isRunning} />
			{artifact?.url && (
				<ExternalLinkIcon className="text-muted-foreground/60 ms-auto size-3.5 shrink-0" />
			)}
		</>
	);

	if (artifact?.url) {
		return (
			<a
				data-slot="aui-document-tool-row"
				className={cn(boxedDownloadToolRowClassName, "cursor-pointer")}
				href={artifact.url}
				target="_blank"
				rel="noreferrer"
			>
				{content}
			</a>
		);
	}

	return (
		<div
			data-slot="aui-document-tool-row"
			className={cn(boxedDownloadToolRowClassName, "opacity-80")}
		>
			{content}
		</div>
	);
};

const GenericAgentToolRow: FC<{ part: DocumentToolPart }> = ({ part }) => {
	if (!isGenericAgentToolName(part.toolName)) return null;

	const labels = FILESYSTEM_TOOL_UI[part.toolName];
	const isRunning =
		part.status.type === "running" || part.status.type === "requires-action";
	const isError =
		part.status.type === "incomplete" && part.status.reason !== "cancelled";
	const label = isRunning
		? labels.running
		: isError
			? labels.error
			: labels.complete;

	return (
		<div
			data-slot="aui-document-tool-row"
			className={cn(flatToolRowClassName, "opacity-80")}
		>
			<DocumentToolRowIcon Icon={labels.Icon} />
			<DocumentToolLabel label={label} running={isRunning} />
		</div>
	);
};

const flatToolRowClassName =
	"text-muted-foreground flex w-full items-center gap-2 py-1 text-left text-xs transition-colors";

const interactiveFlatToolRowClassName =
	"cursor-pointer rounded-sm hover:text-foreground focus-visible:ring-ring/35 focus-visible:ring-2 focus-visible:outline-none";

const boxedDownloadToolRowClassName =
	"border-border/50 bg-muted/25 text-muted-foreground flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors";

const DocumentToolRowIcon: FC<{ Icon: LucideIcon }> = ({ Icon }) => {
	return (
		<span className="flex size-4 shrink-0 items-center justify-center">
			<Icon className="size-3.5" />
		</span>
	);
};

const BoxedToolRowIcon: FC<{ Icon: LucideIcon }> = ({ Icon }) => {
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

function getSearchDocumentTargets(
	chunks: readonly DocumentSourceChunk[],
): SearchDocumentTarget[] {
	const byDocument = new Map<
		string,
		{
			documentId: string;
			filename: string;
			pages: Set<number>;
		}
	>();

	for (const chunk of chunks) {
		if (chunk.page_no === null) continue;
		const existing = byDocument.get(chunk.document_id);
		if (existing) {
			existing.pages.add(chunk.page_no);
			continue;
		}

		byDocument.set(chunk.document_id, {
			documentId: chunk.document_id,
			filename: chunk.filename,
			pages: new Set([chunk.page_no]),
		});
	}

	return [...byDocument.values()]
		.map((target) => {
			const pages = [...target.pages].sort((a, b) => a - b);
			const firstPage = pages[0];
			if (firstPage === undefined) return null;
			return {
				key: target.documentId,
				documentId: target.documentId,
				filename: target.filename,
				firstPage,
				pages,
				pageLabel: formatPageList(pages),
			};
		})
		.filter((target) => target !== null)
		.sort((a, b) => {
			const pageOrder = a.firstPage - b.firstPage;
			if (pageOrder !== 0) return pageOrder;
			return a.filename.localeCompare(b.filename);
		});
}

function formatResultCount(count: number): string {
	return `${count} result${count === 1 ? "" : "s"}`;
}

function formatPageList(pages: readonly number[]): string {
	if (pages.length === 0) return "";
	return `p.${formatJoinedNumbers(pages)}`;
}

function formatJoinedNumbers(values: readonly number[]): string {
	if (values.length <= 2) return values.join(" and ");
	const head = values.slice(0, -1).join(", ");
	return `${head} and ${values.at(-1)}`;
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
	return (
		toolName === "search_documents" ||
		toolName === "read_document" ||
		toolName === "get_download_url"
	);
}

function isGenericAgentToolName(
	toolName: string,
): toolName is Exclude<AgentToolName, DocumentToolName> {
	return toolName in FILESYSTEM_TOOL_UI;
}

function isAgentToolName(toolName: string): toolName is AgentToolName {
	return isDocumentToolName(toolName) || isGenericAgentToolName(toolName);
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
		toolName: AgentToolName;
		parts: DocumentToolPart[];
	}[] = [];

	for (const part of parts) {
		if (!isAgentToolName(part.toolName)) continue;
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
