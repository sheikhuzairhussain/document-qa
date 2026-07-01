import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SectionUploadButton({
	uploading,
	ariaLabel,
	onClick,
}: {
	uploading: boolean;
	ariaLabel: string;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px]"
			disabled={uploading}
			aria-label={ariaLabel}
			onClick={onClick}
		>
			{uploading ? (
				<Loader2 className="size-3 animate-spin" />
			) : (
				<Upload className="size-3" />
			)}
			Upload
		</Button>
	);
}
