export function isPdfFile(file: File): boolean {
	return (
		file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
	);
}

export function getPdfFiles(files: FileList | null | undefined): File[] {
	return Array.from(files ?? []).filter(isPdfFile);
}
