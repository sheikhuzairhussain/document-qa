"use client";

import {
	type MessagePrimitive,
	type ToolCallMessagePart,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
	useAuiState,
} from "@assistant-ui/react";
import { ChevronDownIcon, FileSearchIcon, FileTextIcon } from "lucide-react";
import { type FC, type PropsWithChildren, useMemo } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	type DocumentSourceChunk,
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

export const DocumentToolCall: FC<DocumentToolCallProps> = ({
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
