import { cn, relativeTime } from "@/lib/utils";
import {
	AuiIf,
	ThreadListPrimitive,
	useThreadListItem,
	useThreadListItemRuntime,
} from "@assistant-ui/react";
import {
	MessagesSquare,
	MoreHorizontal,
	Pencil,
	Scale,
	SquarePen,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "./ui/sidebar";

interface ThreadSidebarProps {
	onResizeStart: (e: React.MouseEvent) => void;
	isResizing: boolean;
}

/**
 * A single row in the thread list. Sources its title/active-state/timestamp from
 * assistant-ui's thread-list-item context and drives switch/rename/delete
 * through its runtime, but keeps the original conversation-row styling (active
 * highlight, hover "…" menu, rename dialog, delete confirmation).
 */
function ThreadRow() {
	const item = useThreadListItem();
	const runtime = useThreadListItemRuntime();

	const title = item.title?.trim() || "New chat";
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [draftTitle, setDraftTitle] = useState(title);

	const handleRenameSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = draftTitle.trim();
		if (trimmed && trimmed !== title) {
			runtime.rename(trimmed);
		}
		setRenameOpen(false);
	};

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={item.isMain}
				onClick={() => runtime.switchTo()}
				className="pr-9"
			>
				<span className="min-w-0 flex-1 truncate">{title}</span>
				{item.lastMessageAt && (
					<span className="shrink-0 text-xs text-sidebar-foreground/40 tabular-nums">
						{relativeTime(item.lastMessageAt.toISOString())}
					</span>
				)}
			</SidebarMenuButton>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						title="More options"
						className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<MoreHorizontal className="size-4" />
						<span className="sr-only">More options</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="right"
					align="start"
					className="w-40"
					onCloseAutoFocus={(e) => e.preventDefault()}
				>
					<DropdownMenuItem
						onSelect={() => {
							setDraftTitle(title);
							setRenameOpen(true);
						}}
					>
						<Pencil />
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setDeleteOpen(true)}
					>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent>
					<form onSubmit={handleRenameSubmit} className="grid gap-4">
						<DialogHeader>
							<DialogTitle>Rename chat</DialogTitle>
							<DialogDescription>
								Give this conversation a new name.
							</DialogDescription>
						</DialogHeader>
						<Input
							autoFocus
							value={draftTitle}
							onChange={(e) => setDraftTitle(e.target.value)}
							onFocus={(e) => e.target.select()}
							placeholder="Chat name"
							aria-label="Chat name"
						/>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setRenameOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!draftTitle.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete chat?</AlertDialogTitle>
						<AlertDialogDescription>
							<span className="font-medium text-foreground">{title}</span> and
							all of its messages will be permanently deleted. This can't be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30"
							onClick={() => runtime.delete()}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SidebarMenuItem>
	);
}

/**
 * The chat sidebar. Keeps the original "Orbital" chrome (brand header, new-chat
 * button, drag-to-resize handle, offcanvas collapse) but lists Aegra threads
 * via assistant-ui's thread-list primitives instead of the old conversations.
 */
export function ThreadSidebar({
	onResizeStart,
	isResizing,
}: ThreadSidebarProps) {
	return (
		<Sidebar collapsible="offcanvas">
			<SidebarHeader className="p-2">
				<div className="flex h-8 items-center justify-between gap-2 pl-1.5">
					<div className="flex items-center gap-2">
						<Scale className="size-4 text-foreground/70" strokeWidth={2.25} />
						<span className="text-sm font-semibold tracking-tight">
							Orbital
						</span>
					</div>
					<ThreadListPrimitive.New asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							title="New chat"
							aria-label="New chat"
						>
							<SquarePen className="size-4" />
						</Button>
					</ThreadListPrimitive.New>
				</div>
			</SidebarHeader>

			<SidebarContent>
				<AuiIf
					condition={(s) =>
						!s.threads.isLoading && s.threads.threadIds.length === 0
					}
				>
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-12 text-center">
						<MessagesSquare
							className="size-7 text-sidebar-foreground/25"
							strokeWidth={1.5}
						/>
						<div className="space-y-1">
							<p className="text-sm font-medium text-sidebar-foreground/70">
								No conversations yet
							</p>
							<p className="text-xs leading-relaxed text-pretty text-sidebar-foreground/45">
								Start a chat to ask questions about your documents.
							</p>
						</div>
					</div>
				</AuiIf>

				<SidebarGroup className="pt-0">
					<SidebarGroupContent>
						<SidebarMenu>
							<ThreadListPrimitive.Items>
								{() => <ThreadRow />}
							</ThreadListPrimitive.Items>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			{/* Drag handle to resize the sidebar (desktop only). */}
			<div
				title="Drag to resize"
				onMouseDown={onResizeStart}
				className={cn(
					"absolute inset-y-0 right-0 z-20 hidden w-1 cursor-col-resize transition-colors md:block",
					"after:absolute after:inset-y-0 after:-left-2 after:right-0 after:content-['']",
					"hover:bg-foreground/15",
					isResizing && "bg-foreground/20",
				)}
			/>
		</Sidebar>
	);
}
