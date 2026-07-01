import {
	type Unstable_DirectiveFormatter,
	unstable_defaultDirectiveFormatter,
} from "@assistant-ui/react";
import type { Document } from "@/types";

export const DOCUMENT_MENTION_TYPE = "document";
export const documentMentionFormatter: Unstable_DirectiveFormatter =
	unstable_defaultDirectiveFormatter;

type MentionableDocument = Pick<Document, "id" | "filename">;

export function serializeDocumentMention(
	document: MentionableDocument,
): string {
	return documentMentionFormatter.serialize({
		id: document.id,
		type: DOCUMENT_MENTION_TYPE,
		label: document.filename,
	});
}

export function appendDocumentMention(
	text: string,
	document: MentionableDocument,
): string {
	const prefix = text.length > 0 && !/\s$/.test(text) ? " " : "";
	return `${text}${prefix}${serializeDocumentMention(document)} `;
}

export function extractDocumentMentionIds(text: string): string[] {
	const ids = new Set<string>();

	for (const segment of documentMentionFormatter.parse(text)) {
		if (segment.kind !== "mention") continue;
		if (segment.type !== DOCUMENT_MENTION_TYPE) continue;
		ids.add(segment.id);
	}

	return [...ids];
}
