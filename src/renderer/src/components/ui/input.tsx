import * as React from "react";

import { cn } from "@renderer/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full rounded-md border border-border-strong bg-surface px-4 text-body text-fg transition-base",
        "placeholder:text-fg-subtle",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-label file:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
