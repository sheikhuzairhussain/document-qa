import { FileText, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { DocumentDropIntent } from "@/app/use-page-document-drop";
import { cn } from "@/lib/utils";

export function DocumentDropOverlay({
	activeIntent,
}: {
	activeIntent: DocumentDropIntent | null;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-6 backdrop-blur-[2px]">
			<div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
				<DocumentDropTarget
					intent="focus"
					active={activeIntent === "focus" || activeIntent === null}
					icon={<FileText className="size-5" />}
					title="Add to focus documents"
					description="Pin PDFs to this chat so the agent gives them extra attention"
				/>
				<DocumentDropTarget
					intent="library"
					active={activeIntent === "library"}
					icon={<FolderOpen className="size-5" />}
					title="Add to library"
					description="Store PDFs across chats without making them focus documents"
				/>
			</div>
		</div>
	);
}

function DocumentDropTarget({
	intent,
	active,
	icon,
	title,
	description,
}: {
	intent: DocumentDropIntent;
	active: boolean;
	icon: ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div
			data-document-drop-intent={intent}
			className={cn(
				"flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed bg-white px-5 py-6 text-center shadow-sm transition-colors",
				active
					? "border-neutral-500 bg-neutral-50 text-neutral-900"
					: "border-neutral-200 text-neutral-600",
			)}
		>
			<div
				className={cn(
					"mb-3 flex size-10 items-center justify-center rounded-lg border",
					active
						? "border-neutral-300 bg-white text-neutral-800"
						: "border-neutral-200 bg-neutral-50 text-neutral-400",
				)}
			>
				{icon}
			</div>
			<p className="text-sm font-medium">{title}</p>
			<p className="mt-1 text-xs text-neutral-500">{description}</p>
		</div>
	);
}
