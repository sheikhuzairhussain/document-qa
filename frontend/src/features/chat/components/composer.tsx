import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { PaperclipIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type ChangeEvent, type FC, useRef } from "react";
import { ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { useDocumentsContext } from "@/features/documents/documents-provider";
import { getPdfFiles } from "@/lib/files";

export const Composer: FC = () => {
	return (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col gap-2">
			<ComposerAttachments />
			<ComposerPrimitive.AttachmentDropzone asChild>
				<div
					data-slot="aui_composer-shell"
					className="border-border data-[dragging=true]:border-ring focus-within:border-ring/60 flex w-full items-center gap-1 rounded-xl border bg-muted/40 px-1.5 py-1.5 shadow-sm transition-colors focus-within:bg-background data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/40"
				>
					<ComposerUpload />
					<ComposerPrimitive.Input
						placeholder="Ask about your selected documents..."
						className="aui-composer-input placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed outline-none"
						rows={1}
						autoFocus
						aria-label="Message input"
					/>
					<ComposerSend />
				</div>
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
};

const ComposerUpload: FC = () => {
	const { uploading, upload } = useDocumentsContext();
	const inputRef = useRef<HTMLInputElement>(null);

	const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
		for (const file of getPdfFiles(e.target.files)) {
			void upload(file);
		}
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept="application/pdf,.pdf"
				multiple
				className="hidden"
				onChange={handleChange}
			/>
			<TooltipIconButton
				tooltip="Upload to focus documents"
				side="top"
				type="button"
				variant="ghost"
				size="icon"
				className="aui-composer-upload text-muted-foreground hover:text-foreground size-8 shrink-0"
				aria-label="Upload to focus documents"
				disabled={uploading}
				onClick={() => inputRef.current?.click()}
			>
				<PaperclipIcon className="size-4" />
			</TooltipIconButton>
		</>
	);
};

const ComposerSend: FC = () => {
	return (
		<>
			<AuiIf condition={(s) => !s.thread.isRunning}>
				<ComposerPrimitive.Send asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-send text-foreground disabled:text-muted-foreground/40 size-8 shrink-0"
						aria-label="Send message"
					>
						<SendHorizontalIcon className="size-4" />
					</Button>
				</ComposerPrimitive.Send>
			</AuiIf>
			<AuiIf condition={(s) => s.thread.isRunning}>
				<ComposerPrimitive.Cancel asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-cancel text-foreground size-8 shrink-0"
						aria-label="Stop generating"
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
					</Button>
				</ComposerPrimitive.Cancel>
			</AuiIf>
		</>
	);
};
