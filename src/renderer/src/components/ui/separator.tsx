import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/lib/cn";

const separatorVariants = cva("shrink-0 bg-border", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "h-full w-px",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

type SeparatorProps = Omit<React.ComponentProps<"div">, "role"> &
  VariantProps<typeof separatorVariants> & {
    /** 순수 장식이면 true(기본). 의미 있는 구분이면 false 로 두어 role="separator" 를 낸다. */
    decorative?: boolean;
  };

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      aria-orientation={
        !decorative && orientation === "vertical" ? "vertical" : undefined
      }
      className={cn(separatorVariants({ orientation }), className)}
      {...props}
    />
  );
}

export { Separator };
export type { SeparatorProps };
