import { type DragEvent as ReactDragEvent, useCallback, useState } from "react";
import { getPdfFiles } from "@/lib/files";

export type DocumentDropIntent = "focus" | "library";

function hasFileDrag(dataTransfer: DataTransfer): boolean {
	return Array.from(dataTransfer.types).includes("Files");
}

function documentDropIntentFromTarget(
	target: EventTarget | null,
): DocumentDropIntent | null {
	if (!(target instanceof Element)) return null;
	const dropTarget = target.closest<HTMLElement>("[data-document-drop-intent]");
	const intent = dropTarget?.dataset.documentDropIntent;
	return intent === "focus" || intent === "library" ? intent : null;
}

export function usePageDocumentDrop({
	onUpload,
	onUploadToLibrary,
}: {
	onUpload: (file: File) => void | Promise<void>;
	onUploadToLibrary: (file: File) => void | Promise<void>;
}) {
	const [dragDepth, setDragDepth] = useState(0);
	const [activeIntent, setActiveIntent] = useState<DocumentDropIntent | null>(
		null,
	);
	const isDragging = dragDepth > 0;

	const handleDragEnter = useCallback((e: ReactDragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		setDragDepth(1);
	}, []);

	const handleDragOver = useCallback((e: ReactDragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		setActiveIntent(documentDropIntentFromTarget(e.target));
	}, []);

	const handleDragLeave = useCallback((e: ReactDragEvent) => {
		if (!hasFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		const nextTarget = e.relatedTarget;
		if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
			return;
		}
		setDragDepth(0);
		setActiveIntent(null);
	}, []);

	const handleDrop = useCallback(
		(e: ReactDragEvent) => {
			if (!hasFileDrag(e.dataTransfer)) return;
			e.preventDefault();
			e.stopPropagation();
			setDragDepth(0);
			setActiveIntent(null);

			const files = getPdfFiles(e.dataTransfer.files);
			if (files.length === 0) return;

			const intent = documentDropIntentFromTarget(e.target) ?? "focus";
			const uploadTarget = intent === "library" ? onUploadToLibrary : onUpload;
			for (const file of files) {
				void uploadTarget(file);
			}
		},
		[onUpload, onUploadToLibrary],
	);

	return {
		isDragging,
		activeIntent,
		dragHandlers: {
			onDragEnterCapture: handleDragEnter,
			onDragOverCapture: handleDragOver,
			onDragLeaveCapture: handleDragLeave,
			onDropCapture: handleDrop,
		},
	};
}
