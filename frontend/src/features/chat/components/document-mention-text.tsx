import type { FC } from "react";
import { DocumentMentionChip } from "@/features/chat/components/document-mention-chip";
import {
	DOCUMENT_MENTION_TYPE,
	documentMentionFormatter,
} from "@/features/chat/document-mention-directives";
import { useDocumentsContext } from "@/features/documents/documents-provider";

export const DocumentMentionText: FC<{ text: string }> = ({ text }) => {
	const { documents } = useDocumentsContext();
	const documentsById = new Map(
		documents.map((document) => [document.id, document]),
	);
	let offset = 0;

	return (
		<>
			{documentMentionFormatter.parse(text).map((segment) => {
				const keyOffset = offset;
				if (segment.kind === "text") {
					offset += segment.text.length;
					return (
						<span key={`text:${keyOffset}:${offset}`}>{segment.text}</span>
					);
				}
				offset += documentMentionFormatter.serialize(segment).length;
				if (segment.type !== DOCUMENT_MENTION_TYPE) {
					return (
						<span key={`mention:${segment.type}:${segment.id}:${keyOffset}`}>
							{segment.label}
						</span>
					);
				}

				const filename =
					documentsById.get(segment.id)?.filename ?? segment.label;
				return (
					<DocumentMentionChip
						key={`document:${segment.id}:${keyOffset}`}
						documentId={segment.id}
						filename={filename}
						variant="message"
					/>
				);
			})}
		</>
	);
};
