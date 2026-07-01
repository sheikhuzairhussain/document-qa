import { type DragEvent as ReactDragEvent, useCallback, useState } from "react";
import { type DropEvent, useDropzone } from "react-dropzone";
import {
	PDF_DROPZONE_ACCEPT,
	uploadAcceptedPdfs,
} from "@/features/documents/hooks/use-pdf-upload-dropzone";

export type DocumentDropIntent = "focus" | "library";

function documentDropIntentFromTarget(
	target: EventTarget | null,
): DocumentDropIntent | null {
	if (!(target instanceof Element)) return null;
	const dropTarget = target.closest<HTMLElement>("[data-document-drop-intent]");
	const intent = dropTarget?.dataset.documentDropIntent;
	return intent === "focus" || intent === "library" ? intent : null;
}

function targetFromDropEvent(event: DropEvent): EventTarget | null {
	return Array.isArray(event) ? null : event.target;
}

export function usePageDocumentDrop({
	onUpload,
	onUploadToLibrary,
}: {
	onUpload: (file: File) => void | Promise<void>;
	onUploadToLibrary: (file: File) => void | Promise<void>;
}) {
	const [activeIntent, setActiveIntent] = useState<DocumentDropIntent | null>(
		null,
	);

	const handleDragOver = useCallback((e: ReactDragEvent<HTMLElement>) => {
		setActiveIntent(documentDropIntentFromTarget(e.target));
	}, []);

	const handleDragLeave = useCallback(() => {
		setActiveIntent(null);
	}, []);

	const handleDropAccepted = useCallback(
		(files: File[], event: DropEvent) => {
			setActiveIntent(null);
			const intent =
				documentDropIntentFromTarget(targetFromDropEvent(event)) ?? "focus";
			const uploadTarget = intent === "library" ? onUploadToLibrary : onUpload;
			uploadAcceptedPdfs(files, uploadTarget);
		},
		[onUpload, onUploadToLibrary],
	);

	const dropzone = useDropzone({
		accept: PDF_DROPZONE_ACCEPT,
		multiple: true,
		noClick: true,
		noKeyboard: true,
		onDropAccepted: handleDropAccepted,
		onDropRejected: () => setActiveIntent(null),
	});

	return {
		isDragging: dropzone.isDragActive,
		activeIntent,
		rootProps: dropzone.getRootProps({
			className: "min-h-svh",
			onDragLeave: handleDragLeave,
			onDragOver: handleDragOver,
		}),
	};
}
