"use client";

import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentProps<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
	return (
		<CheckboxPrimitive.Root
			ref={ref}
			data-slot="checkbox"
			className={cn(
				"peer size-4 shrink-0 cursor-pointer rounded-[4px] border border-neutral-300 bg-white shadow-sm outline-none transition-colors",
				"hover:border-neutral-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
				"disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-neutral-300",
				"data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				"data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex items-center justify-center text-current"
			>
				{props.checked === "indeterminate" ? (
					<Minus className="size-3" strokeWidth={3} />
				) : (
					<Check className="size-3" strokeWidth={3} />
				)}
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
});
Checkbox.displayName = "Checkbox";

export { Checkbox };
