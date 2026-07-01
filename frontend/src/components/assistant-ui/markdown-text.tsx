"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import { useAuiState } from "@assistant-ui/react";
import {
	type CodeHeaderProps,
	MarkdownTextPrimitive,
	unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
	useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { CheckIcon, CopyIcon, FileTextIcon } from "lucide-react";
import {
	type AnchorHTMLAttributes,
	type FC,
	createContext,
	memo,
	useContext,
	useMemo,
	useState,
} from "react";
import remarkGfm from "remark-gfm";

import { usePdfViewer } from "@/components/PdfViewer";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	citationHrefToMarker,
	extractSourceChunksFromParts,
	replaceCitationMarkersWithLinks,
} from "@/lib/citations";
import type { DocumentSourceChunk } from "@/lib/citations";
import { cn } from "@/lib/utils";

type CitationSource = DocumentSourceChunk;

interface CitationMetadataContextValue {
	citationsByChunkId: Map<string, CitationSource>;
}

const EMPTY_CITATION_METADATA: CitationMetadataContextValue = {
	citationsByChunkId: new Map(),
};

const CitationMetadataContext = createContext<CitationMetadataContextValue>(
	EMPTY_CITATION_METADATA,
);

const MarkdownTextImpl = () => {
	const messageIndex = useAuiState((s) => s.message.index);
	const threadMessages = useAuiState((s) => s.thread.messages);
	const citationSourceParts = useMemo(() => {
		return threadMessages
			.slice(0, messageIndex + 1)
			.flatMap((message) => message.parts);
	}, [messageIndex, threadMessages]);
	const sourceChunks = useMemo(
		() => extractSourceChunksFromParts(citationSourceParts),
		[citationSourceParts],
	);
	const citationsByChunkId = useMemo(() => {
		const citations = new Map<string, CitationSource>();
		for (const chunk of sourceChunks) {
			citations.set(chunk.chunk_id, chunk);
		}
		return citations;
	}, [sourceChunks]);

	return (
		<CitationMetadataContext.Provider value={{ citationsByChunkId }}>
			<MarkdownTextPrimitive
				remarkPlugins={[remarkGfm]}
				className="aui-md"
				components={defaultComponents}
				preprocess={replaceCitationMarkersWithLinks}
				defer
			/>
		</CitationMetadataContext.Provider>
	);
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
	const { isCopied, copyToClipboard } = useCopyToClipboard();
	const onCopy = () => {
		if (!code || isCopied) return;
		copyToClipboard(code);
	};

	return (
		<div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
			<span className="aui-code-header-language text-muted-foreground font-medium lowercase">
				{language}
			</span>
			<TooltipIconButton tooltip="Copy" onClick={onCopy}>
				{!isCopied && (
					<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
				)}
				{isCopied && (
					<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
				)}
			</TooltipIconButton>
		</div>
	);
};

const useCopyToClipboard = ({
	copiedDuration = 3000,
}: {
	copiedDuration?: number;
} = {}) => {
	const [isCopied, setIsCopied] = useState<boolean>(false);

	const copyToClipboard = (value: string) => {
		if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
			return;
		}

		navigator.clipboard.writeText(value).then(
			() => {
				setIsCopied(true);
				setTimeout(() => setIsCopied(false), copiedDuration);
			},
			() => {},
		);
	};

	return { isCopied, copyToClipboard };
};

function CitationAwareLink({
	className,
	href,
	children,
	...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
	const marker = href ? citationHrefToMarker(href) : null;
	const { citationsByChunkId } = useContext(CitationMetadataContext);
	const citationSource = marker
		? (citationsByChunkId.get(marker.chunkId) ?? null)
		: null;
	const { openDocument } = usePdfViewer();

	if (!marker) {
		return (
			<a
				className={cn(
					"aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
					className,
				)}
				href={href}
				{...props}
			>
				{children}
			</a>
		);
	}

	const pageLabel =
		citationSource?.page_no === null || citationSource?.page_no === undefined
			? "indexed chunk"
			: `p. ${citationSource.page_no}`;
	const tooltipLabel = citationSource
		? `${citationSource.filename}, ${pageLabel}`
		: "Citation metadata unavailable";
	const chipFilename = citationSource?.filename ?? "Citation";
	const chipPageLabel =
		citationSource?.page_no === null || citationSource?.page_no === undefined
			? null
			: `p.${citationSource.page_no}`;

	const handleClick = () => {
		if (!citationSource) return;
		openDocument({
			documentId: citationSource.document_id,
			filename: citationSource.filename,
			pageNo: citationSource.page_no,
			highlightText: marker.highlightText,
			citation: citationSource,
		});
	};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className={cn(
						"border-border/60 bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted mx-0.5 inline-flex h-5 max-w-36 translate-y-[-1px] items-center gap-1 rounded-md border px-1.5 align-baseline text-[11px] leading-none font-medium transition-colors",
						className,
					)}
					onClick={handleClick}
					aria-disabled={!citationSource}
				>
					<FileTextIcon className="size-3 shrink-0 opacity-70" />
					<span className="min-w-0 truncate">{chipFilename}</span>
					{chipPageLabel && (
						<span className="text-muted-foreground/70 shrink-0">
							({chipPageLabel})
						</span>
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				className="max-w-[min(32rem,calc(100vw-2rem))] truncate whitespace-nowrap"
			>
				<span className="font-medium">{tooltipLabel}</span>
			</TooltipContent>
		</Tooltip>
	);
}

const defaultComponents = memoizeMarkdownComponents({
	h1: ({ className, ...props }) => (
		<h1
			className={cn(
				"aui-md-h1 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h2: ({ className, ...props }) => (
		<h2
			className={cn(
				"aui-md-h2 mt-4 mb-1.5 scroll-m-20 text-[15px] font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h3: ({ className, ...props }) => (
		<h3
			className={cn(
				"aui-md-h3 mt-3 mb-1 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h4: ({ className, ...props }) => (
		<h4
			className={cn(
				"aui-md-h4 mt-3 mb-1 scroll-m-20 text-sm font-medium first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h5: ({ className, ...props }) => (
		<h5
			className={cn(
				"aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h6: ({ className, ...props }) => (
		<h6
			className={cn(
				"aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	p: ({ className, ...props }) => (
		<p
			className={cn("aui-md-p my-2 leading-6 first:mt-0 last:mb-0", className)}
			{...props}
		/>
	),
	a: CitationAwareLink,
	blockquote: ({ className, ...props }) => (
		<blockquote
			className={cn(
				"aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-2 border-s-2 ps-4",
				className,
			)}
			{...props}
		/>
	),
	ul: ({ className, ...props }) => (
		<ul
			className={cn(
				"aui-md-ul marker:text-muted-foreground my-2 ms-5 list-disc [&>li]:mt-0.5",
				className,
			)}
			{...props}
		/>
	),
	ol: ({ className, ...props }) => (
		<ol
			className={cn(
				"aui-md-ol marker:text-muted-foreground my-2 ms-5 list-decimal [&>li]:mt-0.5",
				className,
			)}
			{...props}
		/>
	),
	hr: ({ className, ...props }) => (
		<hr
			className={cn("aui-md-hr border-muted-foreground/20 my-2", className)}
			{...props}
		/>
	),
	table: ({ className, ...props }) => (
		<table
			className={cn(
				"aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
				className,
			)}
			{...props}
		/>
	),
	th: ({ className, ...props }) => (
		<th
			className={cn(
				"aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	td: ({ className, ...props }) => (
		<td
			className={cn(
				"aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	tr: ({ className, ...props }) => (
		<tr
			className={cn(
				"aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
				className,
			)}
			{...props}
		/>
	),
	li: ({ className, ...props }) => (
		<li className={cn("aui-md-li leading-6", className)} {...props} />
	),
	strong: ({ className, ...props }) => (
		<strong
			className={cn("aui-md-strong font-semibold", className)}
			{...props}
		/>
	),
	sup: ({ className, ...props }) => (
		<sup
			className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
			{...props}
		/>
	),
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	code: function Code({ className, ...props }) {
		const isCodeBlock = useIsMarkdownCodeBlock();
		return (
			<code
				className={cn(
					!isCodeBlock &&
						"aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
					className,
				)}
				{...props}
			/>
		);
	},
	CodeHeader,
});
