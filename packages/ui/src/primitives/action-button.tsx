"use client";

// Adapted from shadcn/ui's MIT-licensed Radix button pattern.
import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

export const actionButtonVariants = cva(
  "aether-action inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-blue-800 text-white hover:bg-blue-900",
        outline:
          "border border-slate-300 bg-transparent text-slate-900 hover:bg-slate-100",
        light: "bg-white text-blue-900 hover:bg-blue-50",
        ghost: "bg-transparent text-blue-800 hover:bg-blue-50",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function ActionButton({
  asChild = false,
  className,
  variant,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof actionButtonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(actionButtonVariants({ variant, className }))}
      {...props}
    />
  );
}
