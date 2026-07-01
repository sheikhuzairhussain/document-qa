import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useState,
} from "react";

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar_width";

function getInitialSidebarWidth() {
	if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
	const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
	return stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH
		? stored
		: SIDEBAR_DEFAULT_WIDTH;
}

export function useResizableSidebar() {
	const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
	const [isResizing, setIsResizing] = useState(false);

	const handleResizeStart = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			setIsResizing(true);
			const startX = e.clientX;
			const startWidth = sidebarWidth;
			window.document.body.style.cursor = "col-resize";
			window.document.body.style.userSelect = "none";

			const handleMove = (moveEvent: MouseEvent) => {
				const next = Math.min(
					SIDEBAR_MAX_WIDTH,
					Math.max(SIDEBAR_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
				);
				setSidebarWidth(next);
			};

			const handleUp = () => {
				setIsResizing(false);
				window.document.body.style.cursor = "";
				window.document.body.style.userSelect = "";
				window.removeEventListener("mousemove", handleMove);
				window.removeEventListener("mouseup", handleUp);
				setSidebarWidth((width) => {
					window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
					return width;
				});
			};

			window.addEventListener("mousemove", handleMove);
			window.addEventListener("mouseup", handleUp);
		},
		[sidebarWidth],
	);

	return { sidebarWidth, isResizing, handleResizeStart };
}
