import * as React from "react";

import { cn } from "@renderer/lib/cn";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-2 text-label text-fg",
        "peer-disabled:text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
