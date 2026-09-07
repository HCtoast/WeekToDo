import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md transition-base disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-action text-fg-on-action hover:bg-action-hover",
        secondary:
          "border border-border-strong bg-surface text-fg hover:bg-action-soft",
        ghost: "text-fg hover:bg-action-soft",
        danger: "bg-danger text-fg-on-danger hover:bg-danger-hover",
        link: "text-action underline underline-offset-4 hover:text-action-hover",
      },
      size: {
        sm: "h-8 px-3 text-label-sm [&_svg]:icon-sm",
        md: "h-10 px-4 text-label-md [&_svg]:icon-md",
        lg: "h-12 px-6 text-label-lg [&_svg]:icon-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
