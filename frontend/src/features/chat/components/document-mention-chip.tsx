import { FileTextIcon } from "lucide-react";
import type { FC } from "react";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";
import { cn } from "@/lib/utils";

type DocumentMentionChipVariant = "composer" | "message";

export const DocumentMentionChip: FC<{
	filename: string;
	documentId: string;
	variant: DocumentMentionChipVariant;
}> = ({ filename, documentId, variant }) => {
	const { openDocument } = usePdfViewer();

	return (
		<button
			type="button"
			className={cn(
				"border-input bg-background hover:bg-accent hover:text-accent-foreground mx-0.5 inline-flex h-5 max-w-40 cursor-pointer items-center gap-1 rounded-md border px-1.5 align-[-0.12em] text-xs leading-none font-medium text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none",
				variant === "composer" && "max-w-52",
			)}
			title={`${filename} (${documentId})`}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				openDocument({
					documentId,
					filename,
				});
			}}
		>
			<FileTextIcon
				className={cn(
					"size-3 shrink-0 text-muted-foreground",
					variant === "composer" && "text-muted-foreground",
				)}
			/>
			<span className="min-w-0 truncate">{filename}</span>
		</button>
	);
};
