import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

export const documentsQueryKey = ["documents"] as const;

function isIngesting(document: Document): boolean {
	return document.status === "pending" || document.status === "processing";
}

function upsertDocument(documents: Document[] | undefined, document: Document) {
	if (!documents) return [document];
	const index = documents.findIndex((doc) => doc.id === document.id);
	if (index === -1) return [document, ...documents];
	const next = documents.slice();
	next[index] = document;
	return next;
}

/**
 * Owns the full set of documents in the workspace (a flat library). Callers
 * split these into the current chat's focus documents (tracked via the
 * focus-documents store) and the rest. Backed by a single `GET /api/documents`
 * call.
 */
export function useDocuments() {
	const queryClient = useQueryClient();

	const documentsQuery = useQuery({
		queryKey: documentsQueryKey,
		queryFn: ({ signal }) => api.fetchDocuments({ signal }),
		refetchInterval: (query) =>
			query.state.data?.some(isIngesting) ? 2500 : false,
	});

	const uploadMutation = useMutation({
		mutationFn: (file: File) => api.uploadDocument(file),
		onSuccess: (document) => {
			queryClient.setQueryData<Document[]>(documentsQueryKey, (documents) =>
				upsertDocument(documents, document),
			);
			void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (documentId: string) => api.deleteDocument(documentId),
		onSuccess: (_result, documentId) => {
			queryClient.setQueryData<Document[]>(
				documentsQueryKey,
				(documents) =>
					documents?.filter((document) => document.id !== documentId) ?? [],
			);
			void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
		},
	});

	const reprocessMutation = useMutation({
		mutationFn: (documentId: string) => api.reprocessDocument(documentId),
		onSuccess: (document) => {
			queryClient.setQueryData<Document[]>(documentsQueryKey, (documents) =>
				upsertDocument(documents, document),
			);
			void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
		},
	});

	const upload = useCallback(
		async (file: File) => {
			try {
				return await uploadMutation.mutateAsync(file);
			} catch (err) {
				console.error("Failed to upload document", err);
				return null;
			}
		},
		[uploadMutation],
	);

	const refresh = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
	}, [queryClient]);

	const error =
		documentsQuery.error ??
		uploadMutation.error ??
		deleteMutation.error ??
		reprocessMutation.error;

	return {
		documents: documentsQuery.data ?? [],
		loading: documentsQuery.isLoading,
		uploading: uploadMutation.isPending,
		error: error instanceof Error ? error.message : null,
		refresh,
		upload,
		deleteDocument: deleteMutation.mutateAsync,
		reprocessDocument: reprocessMutation.mutateAsync,
	};
}
