import {
	createContext,
	lazy,
	type PropsWithChildren,
	Suspense,
	useCallback,
	useContext,
	useState,
} from "react";
import type { DocumentChunkCitation } from "@/types";

export interface PdfViewerRequest {
	documentId?: string;
	url?: string;
	filename: string;
	pageNo?: number | null;
	highlightText?: string;
	citation?: DocumentChunkCitation | null;
}

interface PdfViewerContextValue {
	openDocument: (request: PdfViewerRequest) => void;
}

const PdfViewerDialog = lazy(() => import("./pdf-viewer-dialog"));
const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

export function PdfViewerProvider({ children }: PropsWithChildren) {
	const [request, setRequest] = useState<PdfViewerRequest | null>(null);

	const openDocument = useCallback((nextRequest: PdfViewerRequest) => {
		setRequest(nextRequest);
	}, []);

	return (
		<PdfViewerContext.Provider value={{ openDocument }}>
			{children}
			{request ? (
				<Suspense fallback={null}>
					<PdfViewerDialog request={request} onOpenChange={setRequest} />
				</Suspense>
			) : null}
		</PdfViewerContext.Provider>
	);
}

export function usePdfViewer(): PdfViewerContextValue {
	const context = useContext(PdfViewerContext);
	if (!context) {
		throw new Error("usePdfViewer must be used within PdfViewerProvider");
	}
	return context;
}
