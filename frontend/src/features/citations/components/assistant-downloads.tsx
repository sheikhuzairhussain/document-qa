"use client";

import { useAuiState } from "@assistant-ui/react";
import {
	DownloadIcon,
	EyeIcon,
	FileIcon,
	FileSpreadsheetIcon,
	FileTextIcon,
	LoaderCircleIcon,
	type LucideIcon,
	PresentationIcon,
} from "lucide-react";
import { type FC, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentTurnParts } from "@/features/chat/hooks/use-current-turn-parts";
import {
	extractSandboxDownloadsFromParts,
	type SandboxDownload,
} from "@/features/citations/citations";
import { usePdfViewer } from "@/features/pdf/pdf-viewer-provider";

export const AssistantDownloads: FC = () => {
	const [officePreview, setOfficePreview] = useState<SandboxDownload | null>(
		null,
	);
	const [downloadingId, setDownloadingId] = useState<string | null>(null);
	const [downloadErrorId, setDownloadErrorId] = useState<string | null>(null);
	const isMessageRunning = useAuiState(
		(s) => s.message.status?.type === "running",
	);
	const { openDocument } = usePdfViewer();
	const turnParts = useCurrentTurnParts();
	const downloads = useMemo(
		() => extractSandboxDownloadsFromParts(turnParts),
		[turnParts],
	);

	if (isMessageRunning || downloads.length === 0) return null;

	return (
		<div
			data-slot="aui_assistant-message-downloads"
			className="border-border bg-background mt-3 overflow-hidden rounded-lg border"
		>
			<div className="border-border/60 bg-muted/20 text-muted-foreground flex items-center gap-1.5 border-b px-2.5 py-1.5 text-xs font-medium">
				<DownloadIcon className="size-3.5" />
				<span>Downloads</span>
			</div>

			<ul className="divide-border/60 divide-y">
				{downloads.map((download) => {
					const Icon = iconForDownload(download);
					const canPreview = download.kind !== "other";
					const isDownloading = downloadingId === download.id;
					const didDownloadFail = downloadErrorId === download.id;

					return (
						<li
							key={download.id}
							className="flex flex-col gap-2 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="flex min-w-0 items-center gap-2.5">
								<span className="border-border/70 bg-muted/20 flex size-8 shrink-0 items-center justify-center rounded-md border">
									<Icon className="text-muted-foreground size-3.5" />
								</span>
								<div className="min-w-0">
									<p className="text-foreground truncate text-sm leading-5 font-medium">
										{download.filename}
									</p>
									<p className="text-muted-foreground text-xs leading-5">
										{labelForDownload(download)}
									</p>
								</div>
							</div>

							<div className="flex shrink-0 items-center gap-2 sm:justify-end">
								<Button
									type="button"
									variant="outline"
									size="xs"
									disabled={!canPreview}
									onClick={() => {
										if (download.kind === "pdf") {
											openDocument({
												filename: download.filename,
												url: download.url,
											});
											return;
										}
										if (isOfficeDownload(download)) {
											setOfficePreview(download);
										}
									}}
								>
									<EyeIcon className="size-3.5" />
									Preview
								</Button>
								<Button
									type="button"
									size="xs"
									disabled={isDownloading}
									onClick={async () => {
										setDownloadingId(download.id);
										setDownloadErrorId(null);
										try {
											await downloadFile(download);
										} catch (error) {
											console.warn("download_file_failed", error);
											setDownloadErrorId(download.id);
										} finally {
											setDownloadingId(null);
										}
									}}
								>
									{isDownloading ? (
										<LoaderCircleIcon className="size-3.5 animate-spin" />
									) : (
										<DownloadIcon className="size-3.5" />
									)}
									{didDownloadFail ? "Try again" : "Download"}
								</Button>
							</div>
						</li>
					);
				})}
			</ul>

			<OfficePreviewDialog
				download={officePreview}
				onOpenChange={(open) => {
					if (!open) setOfficePreview(null);
				}}
			/>
		</div>
	);
};

const OfficePreviewDialog: FC<{
	download: SandboxDownload | null;
	onOpenChange: (open: boolean) => void;
}> = ({ download, onOpenChange }) => {
	if (!download) return null;

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				className="h-[min(88vh,760px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
				style={{ width: "min(88vw, 1100px)", maxWidth: "none" }}
			>
				<DialogHeader className="border-b px-4 py-3 pr-12">
					<div className="flex min-w-0 items-center gap-3">
						<span className="border-border bg-muted/40 flex size-8 shrink-0 items-center justify-center rounded-md border">
							{(() => {
								const Icon = iconForDownload(download);
								return <Icon className="text-muted-foreground size-4" />;
							})()}
						</span>
						<div className="min-w-0">
							<DialogTitle className="truncate text-sm">
								{download.filename}
							</DialogTitle>
							<DialogDescription className="text-xs">
								Office preview
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>
				<iframe
					title={`Preview ${download.filename}`}
					src={officePreviewUrl(download.url)}
					className="size-full border-0 bg-white"
					allowFullScreen
				/>
			</DialogContent>
		</Dialog>
	);
};

function iconForDownload(download: SandboxDownload): LucideIcon {
	if (download.kind === "pdf" || download.kind === "word") return FileTextIcon;
	if (download.kind === "spreadsheet") return FileSpreadsheetIcon;
	if (download.kind === "presentation") return PresentationIcon;
	return FileIcon;
}

function labelForDownload(download: SandboxDownload): string {
	if (download.kind === "pdf") return "PDF";
	if (download.kind === "word") return "Word document";
	if (download.kind === "spreadsheet") return "Spreadsheet";
	if (download.kind === "presentation") return "Presentation";
	return download.extension ? download.extension.toUpperCase() : "File";
}

function isOfficeDownload(download: SandboxDownload): boolean {
	return (
		download.kind === "word" ||
		download.kind === "spreadsheet" ||
		download.kind === "presentation"
	);
}

function officePreviewUrl(downloadUrl: string): string {
	return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(downloadUrl)}`;
}

async function downloadFile(download: SandboxDownload) {
	const response = await fetch(download.url);
	if (!response.ok) {
		throw new Error(`Download failed with status ${response.status}`);
	}

	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	try {
		triggerDownload(objectUrl, download.filename);
	} finally {
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
	}
}

function triggerDownload(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
}
