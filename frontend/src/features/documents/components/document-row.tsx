import {
	AlertCircle,
	FileText,
	Loader2,
	MoreHorizontal,
	RotateCw,
	Star,
	StarOff,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Document } from "@/types";

interface DocumentRowProps {
	document: Document;
	/** Whether this document is exposed to the assistant. */
	checked: boolean;
	/** True when the section is in "all" mode (checkbox locked on). */
	disabled: boolean;
	onToggle?: () => void;
	onPreview: () => void;
	onDelete: () => void;
	onAddToFocus?: () => void;
	onRemoveFromFocus?: () => void;
	availabilityLabel?: string;
	/** Re-run ingestion; surfaced as a "Retry" action for failed documents. */
	onReprocess?: () => void;
}

/** Subtitle under the filename: indexing status, or page count once ready. */
function DocumentStatusLine({ document }: { document: Document }) {
	if (document.status === "completed") {
		return (
			<span className="block text-xs text-neutral-400">
				{document.page_count} page{document.page_count !== 1 ? "s" : ""}
			</span>
		);
	}

	if (document.status === "failed") {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="flex items-center gap-1 text-xs text-destructive">
						<AlertCircle className="h-3 w-3 shrink-0" />
						Indexing failed
					</span>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-64">
					{document.error || "Ingestion failed. Try reprocessing the document."}
				</TooltipContent>
			</Tooltip>
		);
	}

	// pending | processing
	return (
		<span className="flex items-center gap-1 text-xs text-neutral-400">
			<Loader2 className="h-3 w-3 shrink-0 animate-spin" />
			Indexing…
		</span>
	);
}

export function DocumentRow({
	document,
	checked,
	disabled,
	onToggle,
	onPreview,
	onDelete,
	onAddToFocus,
	onRemoveFromFocus,
	availabilityLabel,
	onReprocess,
}: DocumentRowProps) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const focusAction = onAddToFocus
		? {
				label: "Add to focus documents",
				icon: <Star className="h-4 w-4" />,
				onClick: onAddToFocus,
			}
		: onRemoveFromFocus
			? {
					label: "Remove from focus documents",
					icon: <StarOff className="h-4 w-4" />,
					onClick: onRemoveFromFocus,
				}
			: null;

	return (
		<div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
			<Tooltip>
				<TooltipTrigger asChild>
					<Checkbox
						checked={checked}
						disabled={disabled}
						onCheckedChange={onToggle ?? (() => undefined)}
						aria-label={
							availabilityLabel ??
							`Make ${document.filename} searchable in this chat`
						}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-56">
					{availabilityLabel ??
						"Checked library documents are searchable in this chat"}
				</TooltipContent>
			</Tooltip>
			<button
				type="button"
				onClick={onPreview}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
			>
				<FileText className="h-4 w-4 shrink-0 text-neutral-400" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm text-neutral-700">
						{document.filename}
					</span>
					<DocumentStatusLine document={document} />
				</span>
			</button>

			{onReprocess && document.status === "failed" && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="shrink-0 cursor-pointer text-neutral-400 hover:text-neutral-700"
							aria-label={`Retry processing ${document.filename}`}
							onClick={onReprocess}
						>
							<RotateCw className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-none">
						Retry processing
					</TooltipContent>
				</Tooltip>
			)}

			{focusAction && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="shrink-0 cursor-pointer text-neutral-400 hover:text-neutral-700"
							aria-label={`${focusAction.label}: ${document.filename}`}
							onClick={focusAction.onClick}
						>
							{focusAction.icon}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-none">
						{focusAction.label}
					</TooltipContent>
				</Tooltip>
			)}

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="shrink-0 cursor-pointer text-neutral-400 hover:text-neutral-700"
						aria-label={`Actions for ${document.filename}`}
					>
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-32">
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setConfirmOpen(true)}
					>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<DestructiveConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title="Delete document?"
				entityName={document.filename}
				onConfirm={onDelete}
			>
				will be permanently removed from the library and unpinned from any chat
				where it is a focus document. This can't be undone.
			</DestructiveConfirmDialog>
		</div>
	);
}
