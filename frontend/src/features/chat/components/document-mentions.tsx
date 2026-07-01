import { FileTextIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { serializeDocumentMention } from "@/features/chat/document-mention-directives";
import { useDocumentsContext } from "@/features/documents/documents-provider";
import { cn } from "@/lib/utils";
import type { AvailableDocuments, Document } from "@/types";

export const DocumentMentionPopover: FC<{
	availableDocuments: AvailableDocuments;
	composerText: string;
	onInserted: (documentId: string) => void;
	onRequestFocus: () => void;
	onTextChange: (text: string) => void;
}> = ({
	availableDocuments,
	composerText,
	onInserted,
	onRequestFocus,
	onTextChange,
}) => {
	const { documents, focusDocumentIds } = useDocumentsContext();
	const [selection, setSelection] = useState({ key: "", index: 0 });
	const activeMention = getTrailingMention(composerText);
	const matchingDocuments = useMemo(() => {
		const availableDocumentIds =
			availableDocuments === "all" ? null : new Set(availableDocuments);
		const query = activeMention?.query.trim().toLowerCase() ?? "";

		return documents
			.filter(
				(document) =>
					availableDocumentIds === null ||
					availableDocumentIds.has(document.id),
			)
			.filter(
				(document) =>
					query.length === 0 || document.filename.toLowerCase().includes(query),
			)
			.sort((a, b) => compareDocuments(a, b, focusDocumentIds))
			.slice(0, 8);
	}, [activeMention, availableDocuments, documents, focusDocumentIds]);
	const selectionKey = `${activeMention?.start ?? -1}:${activeMention?.query ?? ""}:${matchingDocuments.map((document) => document.id).join("\u0000")}`;
	const selectedIndex = selection.key === selectionKey ? selection.index : 0;
	const selectedDocument =
		matchingDocuments[Math.min(selectedIndex, matchingDocuments.length - 1)] ??
		null;

	const insertDocument = useCallback(
		(document: Document) => {
			if (!activeMention) return;
			onTextChange(
				insertDocumentMention(composerText, activeMention, document),
			);
			onInserted(document.id);
			onRequestFocus();
		},
		[activeMention, composerText, onInserted, onRequestFocus, onTextChange],
	);

	const updateSelectedIndex = useCallback(
		(updater: number | ((index: number) => number)) => {
			setSelection((current) => {
				const currentIndex = current.key === selectionKey ? current.index : 0;
				const nextIndex =
					typeof updater === "function" ? updater(currentIndex) : updater;
				return { key: selectionKey, index: nextIndex };
			});
		},
		[selectionKey],
	);

	useEffect(() => {
		if (!activeMention) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				updateSelectedIndex((index) =>
					matchingDocuments.length === 0
						? 0
						: (index + 1) % matchingDocuments.length,
				);
				return;
			}

			if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				updateSelectedIndex((index) =>
					matchingDocuments.length === 0
						? 0
						: (index - 1 + matchingDocuments.length) % matchingDocuments.length,
				);
				return;
			}

			if (event.key !== "Enter") return;
			event.preventDefault();
			event.stopPropagation();
			if (selectedDocument) insertDocument(selectedDocument);
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [
		activeMention,
		insertDocument,
		matchingDocuments.length,
		selectedDocument,
		updateSelectedIndex,
	]);

	if (!activeMention) return null;

	return (
		<div className="absolute bottom-full left-10 z-50 mb-2 max-h-80 w-[28rem] max-w-[calc(100%-5rem)] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
			<div className="max-h-72 overflow-y-auto">
				{matchingDocuments.length > 0 ? (
					matchingDocuments.map((document, index) => {
						const selected = selectedDocument?.id === document.id;
						return (
							<button
								key={document.id}
								type="button"
								data-selected={selected ? "" : undefined}
								className={cn(
									"flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
									"hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
									selected && "bg-accent text-accent-foreground",
								)}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => updateSelectedIndex(index)}
								onClick={() => insertDocument(document)}
							>
								<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{document.filename}
									</span>
									<span className="block truncate text-xs text-muted-foreground">
										{documentDescription(
											document,
											focusDocumentIds.has(document.id),
										)}
									</span>
								</span>
							</button>
						);
					})
				) : (
					<p className="px-3 py-2 text-xs text-muted-foreground">
						No matching documents.
					</p>
				)}
			</div>
		</div>
	);
};

type TrailingMention = {
	readonly start: number;
	readonly end: number;
	readonly query: string;
};

function getTrailingMention(text: string): TrailingMention | null {
	const start = text.lastIndexOf("@");
	if (start === -1) return null;
	if (start > 0 && !/\s/.test(text[start - 1] ?? "")) return null;

	const query = text.slice(start + 1);
	if (query.includes("\n") || /\s/.test(query)) return null;

	return {
		start,
		end: text.length,
		query,
	};
}

function insertDocumentMention(
	text: string,
	mention: TrailingMention,
	document: Document,
): string {
	const afterMention = text.slice(mention.end);
	const separator =
		afterMention.length === 0 ? " " : afterMention.startsWith(" ") ? "" : " ";
	return `${text.slice(0, mention.start)}${serializeDocumentMention(document)}${separator}${afterMention}`;
}

function compareDocuments(
	a: Document,
	b: Document,
	focusDocumentIds: ReadonlySet<string>,
): number {
	const aFocus = focusDocumentIds.has(a.id);
	const bFocus = focusDocumentIds.has(b.id);
	if (aFocus !== bFocus) return aFocus ? -1 : 1;
	return a.filename.localeCompare(b.filename, undefined, {
		sensitivity: "base",
	});
}

function documentDescription(
	document: Document,
	isFocusDocument: boolean,
): string {
	const scope = isFocusDocument ? "Focus document" : "Library document";
	const pages = `${document.page_count} page${document.page_count === 1 ? "" : "s"}`;
	if (document.status === "completed") return `${scope} · ${pages}`;
	return `${scope} · ${document.status}`;
}
