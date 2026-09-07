/**
 * 구글 캘린더 색을 이 위젯의 블록 색으로 옮긴다.
 *
 * ## 왜 그대로 쓰지 않는가
 * 구글 색은 채도가 높다. 이 위젯은 유리 배경 위에 얹히는 배경형 도구라 그대로 쓰면
 * 블록이 화면 앞으로 튀어나오고, 무엇보다 **카테고리 색(S 34~44%)과 구분되지 않는다.**
 * 실제로 구글 기본 파랑이 `cat-dev`(개발·자기계발)와 거의 같은 색이었다.
 *
 * 그래서 **hue만 가져오고 채도는 눌러서** 쓴다. 규칙은 이렇다.
 *   - 색이 있으면 내 것(옮길 수 있다), 흐린 색이면 외부에서 온 것(읽기 전용)
 *   - 캘린더/일정별 hue 차이는 살아남는다 (파란 회사 일정 ↔ 노란 개인 일정)
 *
 * ## 어디서 오는가
 * 우선순위는 **일정별 색(colorId) → 캘린더 색 → 무채색**이다.
 * 구글에서 일정 하나하나에 색을 칠했으면 그게 이기고, 안 칠했으면 캘린더 색을 따른다.
 */

/** 구글 이벤트 색 팔레트 (`colors.get`의 `event`). id는 문자열 "1"~"11"로 온다. */
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#a4bdfc', // Lavender
  '2': '#7ae7bf', // Sage
  '3': '#dbadff', // Grape
  '4': '#ff887c', // Flamingo
  '5': '#fbd75b', // Banana
  '6': '#ffb878', // Tangerine
  '7': '#46d6db', // Peacock
  '8': '#e1e1e1', // Graphite
  '9': '#5484ed', // Blueberry
  '10': '#51b749', // Basil
  '11': '#dc2127', // Tomato
}

/** 구글 색이 없을 때 쓰는 무채색. 카테고리와 확실히 갈리도록 채도를 거의 0으로 둔다. */
export const GOOGLE_NEUTRAL = { h: 220, s: 7, l: 61 }

/**
 * 블록으로 쓸 때의 채도 상한(%).
 *
 * 카테고리는 34~44%다. 그 아래로 눌러야 "색이 있으면 내 것"이라는 구분이 유지된다.
 * 0으로 만들지는 않는다 — hue가 남아야 회사(파랑)/개인(노랑)이 갈린다.
 */
export const GOOGLE_MAX_SATURATION = 22

/** 구글 블록의 밝기(%). 카테고리(66)보다 살짝 낮춰 뒤로 물러나게 한다. */
export const GOOGLE_LIGHTNESS = 61

export interface Hsl {
  h: number
  s: number
  l: number
}

/** `#rrggbb` → HSL. 구글이 주는 형식이 hex뿐이다. */
export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null

  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }

  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4

  return {
    h: Math.round(((h * 60) % 360 + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

/**
 * 구글 일정 하나가 그리드에서 가질 색.
 *
 * `colorId`가 있으면 그 색, 없으면 캘린더 색, 둘 다 없으면 무채색.
 * 어느 쪽이든 채도와 밝기는 이 앱 규격으로 눌러서 돌려준다.
 */
export function googleBlockColor(
  colorId: string | null,
  calendarColor: string | null,
): string {
  const source =
    (colorId !== null ? GOOGLE_EVENT_COLORS[colorId] : undefined) ?? calendarColor ?? null

  const hsl = source !== null ? hexToHsl(source) : null
  const base = hsl ?? GOOGLE_NEUTRAL

  // 회색 계열(Graphite 등)은 hue가 의미 없으므로 그대로 무채색으로 둔다.
  const s = Math.min(base.s, GOOGLE_MAX_SATURATION)
  return `hsl(${base.h} ${s}% ${GOOGLE_LIGHTNESS}%)`
}
