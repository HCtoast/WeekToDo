import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";

import { cn } from "@renderer/lib/cn";

/**
 * 체크박스.
 *
 * 원본 HCToast 레지스트리에는 없어서 같은 토큰·같은 관례로 새로 맞췄다.
 * 네이티브 `<input type="checkbox">`는 `accent-color`로 색만 바꿀 수 있을 뿐
 * 크기·모서리·체크 모양이 OS마다 달라, 유리 배경 위에서 다른 컨트롤과 톤이 어긋난다.
 *
 * Portal을 쓰지 않으므로 `.hct`를 다시 세울 필요가 없다 (select·dialog와 다른 점).
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded border border-border-strong bg-bg-inset transition-base",
        "data-[state=checked]:border-action data-[state=checked]:bg-action data-[state=checked]:text-fg-on-action",
        "data-[state=indeterminate]:border-action data-[state=indeterminate]:bg-action data-[state=indeterminate]:text-fg-on-action",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
