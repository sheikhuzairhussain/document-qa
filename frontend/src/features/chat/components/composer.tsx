import {
	AuiIf,
	ComposerPrimitive,
	type Unstable_TriggerItem,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { PaperclipIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useRef } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { DocumentMentionChip } from "@/features/chat/components/document-mention-chip";
import { DocumentMentionPopover } from "@/features/chat/components/document-mentions";
import {
	appendDocumentMention,
	DOCUMENT_MENTION_TYPE,
	extractDocumentMentionIds,
} from "@/features/chat/document-mention-directives";
import { useDocumentsContext } from "@/features/documents/documents-provider";
import { usePdfUploadDropzone } from "@/features/documents/hooks/use-pdf-upload-dropzone";
import type { AvailableDocuments } from "@/types";

export const Composer: FC<{ availableDocuments: AvailableDocuments }> = ({
	availableDocuments,
}) => {
	const aui = useAui();
	const inputRef = useRef<HTMLDivElement>(null);
	const currentThreadId = useAuiState((state) => state.threads.mainThreadId);
	const composerText = useAuiState((state) => state.composer.text);
	const { documents, focusDocumentIds, addToFocus } = useDocumentsContext();

	const addDocumentToFocus = useCallback(
		(documentId: string) => {
			if (focusDocumentIds.has(documentId)) return;
			const document = documents.find((item) => item.id === documentId);
			if (!document) return;
			void addToFocus(document).catch((error) => {
				console.error("Failed to add mentioned document to focus", error);
			});
		},
		[addToFocus, documents, focusDocumentIds],
	);

	const promoteMentionedDocuments = useCallback(() => {
		for (const documentId of extractDocumentMentionIds(composerText)) {
			addDocumentToFocus(documentId);
		}
	}, [addDocumentToFocus, composerText]);

	const handleMentionInserted = useCallback(
		(documentId: string) => {
			addDocumentToFocus(documentId);
		},
		[addDocumentToFocus],
	);

	const handleDirectiveSelected = useCallback(
		(item: Unstable_TriggerItem) => {
			if (item.type !== DOCUMENT_MENTION_TYPE) return;
			addDocumentToFocus(item.id);
		},
		[addDocumentToFocus],
	);

	useEffect(() => {
		if (!currentThreadId) return;
		const frame = window.requestAnimationFrame(() => {
			inputRef.current?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [currentThreadId]);

	return (
		<ComposerPrimitive.Root
			className="aui-composer-root relative flex w-full flex-col gap-2"
			onSubmit={promoteMentionedDocuments}
		>
			<DocumentMentionPopover
				availableDocuments={availableDocuments}
				composerText={composerText}
				onInserted={handleMentionInserted}
				onTextChange={(nextText) => aui.composer().setText(nextText)}
				onRequestFocus={() =>
					window.requestAnimationFrame(() => {
						inputRef.current?.focus({ preventScroll: true });
					})
				}
			/>
			<ComposerPrimitive.AttachmentDropzone asChild>
				<div
					data-slot="aui_composer-shell"
					className="border-border data-[dragging=true]:border-ring focus-within:border-ring/60 flex w-full items-center gap-1 rounded-xl border bg-muted/40 px-1.5 py-1.5 transition-colors focus-within:bg-background data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/40"
				>
					<ComposerUpload />
					<LexicalComposerInput
						ref={inputRef}
						placeholder="Ask about your selected documents..."
						directiveChip={ComposerDocumentMentionChip}
						directivePluginProps={{
							onDirectiveSelect: handleDirectiveSelected,
						}}
						submitMode="enter"
						autoFocus
						className="aui-composer-input relative max-h-40 min-h-9 flex-1 overflow-y-auto text-sm leading-6 [&_.aui-lexical-input]:min-h-9 [&_.aui-lexical-input]:px-1 [&_.aui-lexical-input]:py-2 [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:inset-x-0 [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:px-1 [&_.aui-lexical-placeholder]:py-2 [&_.aui-lexical-placeholder]:text-muted-foreground/80"
					/>
					<ComposerSend onBeforeSend={promoteMentionedDocuments} />
				</div>
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
};

const ComposerDocumentMentionChip: FC<DirectiveChipProps> = ({
	directiveId,
	label,
}) => {
	return (
		<DocumentMentionChip
			documentId={directiveId}
			filename={label}
			variant="composer"
		/>
	);
};

const ComposerUpload: FC = () => {
	const aui = useAui();
	const { uploading, upload } = useDocumentsContext();
	const uploadDropzone = usePdfUploadDropzone({
		disabled: uploading,
		onUpload: async (file) => {
			const document = await upload(file);
			if (!document) return;
			const composer = aui.composer();
			composer.setText(
				appendDocumentMention(composer.getState().text, document),
			);
		},
	});

	return (
		<>
			<input
				{...uploadDropzone.getInputProps({
					"aria-label": "Attach PDF to focus documents",
					className: "hidden",
				})}
			/>
			<TooltipIconButton
				tooltip="Attach PDF"
				side="top"
				type="button"
				variant="ghost"
				size="icon"
				className="aui-composer-upload text-muted-foreground hover:text-foreground size-8 shrink-0"
				aria-label="Attach PDF to focus documents"
				disabled={uploading}
				onClick={uploadDropzone.open}
			>
				<PaperclipIcon className="size-4" />
			</TooltipIconButton>
		</>
	);
};

const ComposerSend: FC<{ onBeforeSend: () => void }> = ({ onBeforeSend }) => {
	return (
		<>
			<AuiIf condition={(s) => !s.thread.isRunning}>
				<ComposerPrimitive.Send asChild onClick={onBeforeSend}>
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
