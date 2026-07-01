import type { ReactNode } from "react";
import type { Document } from "../types";
import { DocumentRow } from "./DocumentRow";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface DocumentSectionProps {
	title: string;
	description?: string;
	documents: Document[];
	/** Focus documents are always available and have no selection controls. */
	focus?: boolean;
	/** Library "all" mode: every doc (current + future) is available. */
	allSelected?: boolean;
	/** Individually-selected library doc ids, used only when `allSelected` is false. */
	selectedIds?: Set<string>;
	onToggleAll?: () => void;
	onToggleDoc?: (id: string) => void;
	onPreview: (document: Document) => void;
	onDelete: (document: Document) => void;
	onAddToFocus?: (document: Document) => void;
	onRemoveFromFocus?: (document: Document) => void;
	/** Re-run ingestion for a document (offered for failed documents). */
	onReprocess?: (document: Document) => void;
	action?: ReactNode;
	emptyHint: string;
	loading?: boolean;
}

export function DocumentSection({
	title,
	description,
	documents,
	focus = false,
	allSelected = false,
	selectedIds = new Set<string>(),
	onToggleAll,
	onToggleDoc,
	onPreview,
	onDelete,
	onAddToFocus,
	onRemoveFromFocus,
	onReprocess,
	action,
	emptyHint,
	loading = false,
}: DocumentSectionProps) {
	const count = documents.length;

	return (
		<section>
			<div className="mb-1.5 flex items-start justify-between gap-2 px-2">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						{!focus && onToggleAll && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Checkbox
										checked={allSelected}
										onCheckedChange={onToggleAll}
										aria-label="Make every library document searchable in this chat"
									/>
								</TooltipTrigger>
								<TooltipContent side="bottom" className="max-w-none">
									{allSelected
										? "Every library document is searchable in this chat"
										: "Make every library document searchable in this chat"}
								</TooltipContent>
							</Tooltip>
						)}
						<h3 className="truncate text-sm font-medium text-neutral-700">
							{title}
						</h3>
						{count > 0 && (
							<span className="shrink-0 rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium text-neutral-500 tabular-nums">
								{count}
							</span>
						)}
					</div>
					{description && (
						<p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
							{description}
						</p>
					)}
				</div>
				{action}
			</div>

			{count === 0 ? (
				<p className="mt-2 px-2 pb-1 text-[11px] leading-snug text-neutral-400">
					{loading ? "Loading…" : emptyHint}
				</p>
			) : (
				<ul className="space-y-0.5">
					{documents.map((doc) => (
						<DocumentRow
							key={doc.id}
							document={doc}
							checked={focus || allSelected || selectedIds.has(doc.id)}
							disabled={focus || allSelected}
							onToggle={focus ? undefined : () => onToggleDoc?.(doc.id)}
							onPreview={() => onPreview(doc)}
							onDelete={() => onDelete(doc)}
							onAddToFocus={onAddToFocus ? () => onAddToFocus(doc) : undefined}
							onRemoveFromFocus={
								onRemoveFromFocus ? () => onRemoveFromFocus(doc) : undefined
							}
							onReprocess={onReprocess ? () => onReprocess(doc) : undefined}
							availabilityLabel={
								focus
									? `${doc.filename} is pinned to this chat and always searchable`
									: `Make ${doc.filename} searchable in this chat`
							}
						/>
					))}
				</ul>
			)}
		</section>
	);
}
