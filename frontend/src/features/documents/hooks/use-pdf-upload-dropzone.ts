import { useCallback } from "react";
import { type Accept, useDropzone } from "react-dropzone";

export const PDF_DROPZONE_ACCEPT = {
	"application/pdf": [".pdf"],
} satisfies Accept;

type UploadHandler = (file: File) => void | Promise<void>;

export function uploadAcceptedPdfs(
	files: readonly File[],
	onUpload: UploadHandler,
) {
	for (const file of files) {
		void onUpload(file);
	}
}

export function usePdfUploadDropzone({
	disabled = false,
	onUpload,
}: {
	disabled?: boolean;
	onUpload: UploadHandler;
}) {
	const handleDropAccepted = useCallback(
		(files: File[]) => {
			uploadAcceptedPdfs(files, onUpload);
		},
		[onUpload],
	);

	return useDropzone({
		accept: PDF_DROPZONE_ACCEPT,
		disabled,
		multiple: true,
		noClick: true,
		noDrag: true,
		noKeyboard: true,
		onDropAccepted: handleDropAccepted,
	});
}
