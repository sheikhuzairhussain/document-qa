import { z } from "zod/v4-mini";
import type { AvailableDocuments, DocSelection } from "@/types";

export const documentIdListSchema = z.array(z.string());

export const availableDocumentsSchema = z.union([
	z.literal("all"),
	documentIdListSchema,
]);

export const documentSelectionSchema = z.object({
	library: availableDocumentsSchema,
});

const unknownRecordSchema = z.record(z.string(), z.unknown());

export function parseDocumentIdList(value: unknown): string[] {
	const parsed = documentIdListSchema.safeParse(value);
	return parsed.success ? parsed.data : [];
}

export function parseDocumentSelection(
	value: unknown,
	fallback: DocSelection,
): DocSelection {
	const parsed = documentSelectionSchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
}

export function parseAvailableDocuments(
	value: unknown,
	fallback: AvailableDocuments,
): AvailableDocuments {
	const parsed = availableDocumentsSchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
}

export function parseUnknownRecord(value: unknown): Record<string, unknown> {
	const parsed = unknownRecordSchema.safeParse(value);
	return parsed.success ? parsed.data : {};
}
