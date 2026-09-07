import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@renderer/lib/cn";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-4 text-body text-fg transition-base",
        "data-[placeholder]:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50",
        "[&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="icon-sm shrink-0 text-fg-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        "flex items-center justify-center py-2 text-fg-muted",
        className,
      )}
      {...props}
    >
      <ChevronUp className="icon-sm" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        "flex items-center justify-center py-2 text-fg-muted",
        className,
      )}
      {...props}
    >
      <ChevronDown className="icon-sm" />
    </SelectPrimitive.ScrollDownButton>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={position === "popper" ? sideOffset : undefined}
        className={cn(
          // `hct`가 반드시 붙어야 한다: 이 내용은 Portal로 document.body에 붙으므로
          // 트리거를 감싼 `.hct` 밖으로 나간다. 없으면 토큰이 정의되지 않아
          // 배경도 글자색도 안 잡힌 채로 그려진다.
          "hct",
          "z-50 max-h-64 min-w-40 overflow-hidden rounded-lg border border-border bg-surface-raised text-fg shadow-e2",
          "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          position === "popper" &&
            "w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-2">
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-2 text-caption text-fg-muted", className)}
      {...props}
    />
  );
}

type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item> & {
  /**
   * 왼쪽 체크 표시를 쓸지. 기본은 쓴다.
   *
   * `false`면 체크 자리(pl-8)를 통째로 없애고 **선택된 항목을 색과 굵기로** 드러낸다.
   * 시/분처럼 두 글자짜리 좁은 목록에서는 체크 표시가 칸을 절반 넘게 잡아먹어
   * 정작 읽어야 할 숫자가 밀린다.
   */
  showIndicator?: boolean;
};

function SelectItem({
  className,
  children,
  showIndicator = true,
  ...props
}: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-default select-none items-center rounded-md py-2 text-body-sm outline-none transition-base",
        showIndicator ? "pl-8 pr-2" : "px-2",
        // 커서(highlight)는 배경만, 선택 상태는 글자만 건드린다 —
        // 서로 다른 속성을 써야 둘이 겹쳐도 어느 쪽이 이기는지 다투지 않는다.
        "data-[highlighted]:bg-action-soft",
        showIndicator
          ? "data-[highlighted]:text-fg"
          : "data-[state=checked]:font-semibold data-[state=checked]:text-action",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {showIndicator && (
        <span className="absolute left-2 inline-flex size-4 items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check className="icon-sm" />
          </SelectPrimitive.ItemIndicator>
        </span>
      )}
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn("-mx-2 my-2 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
