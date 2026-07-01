import type { AvailableDocuments, Document } from "@/types";

export function normalizeAvailableDocuments(
	documents: AvailableDocuments,
): AvailableDocuments {
	return documents === "all" ? "all" : [...new Set(documents.filter(Boolean))];
}

export function resolveAvailableDocuments({
	documents,
	focusDocumentIds,
	librarySelection,
}: {
	documents: readonly Document[];
	focusDocumentIds: ReadonlySet<string>;
	librarySelection: AvailableDocuments;
}): AvailableDocuments {
	if (librarySelection === "all") return "all";

	const existingDocumentIds = new Set(documents.map((document) => document.id));
	const ids = new Set<string>();

	for (const id of focusDocumentIds) {
		if (existingDocumentIds.has(id)) ids.add(id);
	}

	for (const id of librarySelection) {
		if (existingDocumentIds.has(id) && !focusDocumentIds.has(id)) ids.add(id);
	}

	return [...ids];
}
