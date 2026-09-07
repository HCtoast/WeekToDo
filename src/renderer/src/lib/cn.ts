import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * HCToast 의 커스텀 유틸리티를 tailwind-merge 에 등록한다.
 *
 * 안 하면 tailwind-merge 가 `text-body`(타이포) 와 `text-fg-on-action`(색) 을
 * 같은 그룹으로 묶어 뒤엣것만 남기고 앞엣것을 조용히 버린다 — 버튼 텍스트 색이
 * 사라지는 식의 버그가 난다. 타이포는 font-size 그룹, 시맨틱 색은 색 그룹으로
 * 명시해서 서로 충돌하지 않게 한다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "h1",
            "h2",
            "h3",
            "body-lg",
            "body",
            "body-sm",
            "label",
            "label-sm",
            "label-md",
            "label-lg",
            "caption",
            "code",
          ],
        },
      ],
      "text-color": [
        {
          text: [
            "bg",
            "fg",
            "fg-muted",
            "fg-subtle",
            "fg-on-action",
            "fg-on-danger",
            "fg-on-solid",
            "action",
            "action-hover",
            "accent",
            "danger",
            "warning",
            "success",
            "info",
          ],
        },
      ],
      "font-family": [{ font: ["display"] }],
      "bg-color": [
        {
          bg: [
            "bg",
            "bg-inset",
            "surface",
            "surface-raised",
            "overlay",
            "action",
            "action-hover",
            "action-soft",
            "accent",
            "fg",
            "danger",
            "danger-hover",
            "warning",
            "success",
            "info",
          ],
        },
      ],
      "border-color": [
        { border: ["border", "border-strong", "accent"] },
      ],
      // icon-sm/md/lg 는 width+height 를 함께 세팅 → size/w/h 유틸과 충돌시킨다.
      size: ["icon-sm", "icon-md", "icon-lg"],
    },
  },
});

/** className 병합 유틸. 모든 컴포넌트는 마지막에 이걸로 className 을 합친다. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
