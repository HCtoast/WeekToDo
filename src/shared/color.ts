import { CATEGORY_LIGHTNESS_STEP } from '@shared/constants'

/**
 * 카테고리 색은 HSL로 저장한다.
 * hue는 카테고리 고유값으로 고정하고 lightness만 렌더링 시점에 조절해서
 * "같은 카테고리가 인접했을 때 구분"을 만든다. 파생된 색은 DB에 저장하지 않는다.
 */

export interface Hsl {
  h: number
  s: number
  l: number
}

/** 저장 정규 형식. CSS Color 4 공백 구분 표기를 쓴다. */
const HSL_RE = /^hsl\(\s*(-?[\d.]+)\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%\s*\)$/i

export function parseHsl(value: string): Hsl {
  const m = HSL_RE.exec(value.trim())
  if (!m) throw new Error(`HSL 형식이 아닙니다: ${value}`)
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) }
}

export function formatHsl({ h, s, l }: Hsl): string {
  const round = (n: number) => Math.round(n * 10) / 10
  return `hsl(${round(h)} ${round(s)}% ${round(l)}%)`
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function shiftLightness(color: Hsl, delta: number): Hsl {
  return { ...color, l: clamp(color.l + delta, 0, 100) }
}

/**
 * 같은 카테고리 블록이 연속으로 인접할 때 명도를 교차시킨다.
 * `runIndex`는 "그 연속 구간에서 몇 번째인가" — 짝수는 그대로, 홀수는 밝게.
 * (예: 게임1은 기본색, 게임2는 +8%p)
 *
 * 밝은 쪽이 이미 한계에 가까우면 반대로 어둡게 내린다.
 * 그러지 않으면 lightness 95% 같은 색에서 두 블록이 구분되지 않는다.
 */
/**
 * 블록 글자색. 배경이 무엇이든 **검은 계열로 통일**한다.
 *
 * 밝기에 따라 흰/검정을 갈랐더니 블록마다 글자색이 달라 시선이 흩어졌다.
 * 대신 블록 배경이 항상 이 글자를 받쳐줄 만큼 밝아야 한다 — `BLOCK_MIN_LIGHTNESS` 참고.
 */
export const BLOCK_TEXT_COLOR = '#14161c'

/**
 * 블록 배경의 최소 밝기(%).
 *
 * 글자를 검정으로 통일했으므로 배경이 이보다 어두우면 안 읽힌다.
 * 카테고리 고유색(hue)은 그대로 두고 밝기만 끌어올린다.
 */
export const BLOCK_MIN_LIGHTNESS = 58

/** 너무 어두운 카테고리 색을 검은 글자가 읽힐 만큼만 밝힌다. */
export function ensureReadableBackground(color: string): string {
  const hsl = parseHsl(color)
  return hsl.l >= BLOCK_MIN_LIGHTNESS
    ? formatHsl(hsl)
    : formatHsl({ ...hsl, l: BLOCK_MIN_LIGHTNESS })
}

/**
 * 블록 왼쪽 띠의 밝기(%)와 최소 채도(%).
 *
 * 배경은 검은 글자를 받치느라 밝은 쪽으로 몰려 있어 카테고리끼리 색이 비슷해 보인다.
 * 띠는 그 반대로 어둡고 진하게 뽑아 hue 차이가 바로 드러나게 한다.
 */
export const BLOCK_ACCENT_LIGHTNESS = 34
export const BLOCK_ACCENT_MIN_SATURATION = 45

/** 카테고리가 없는 블록(구글 이벤트 등)의 띠 색 */
export const BLOCK_ACCENT_FALLBACK = 'hsl(220 12% 42%)'

/**
 * 카테고리 색에서 왼쪽 띠 색을 뽑는다.
 *
 * 구글 이벤트만 띠가 있으면 나란히 놓았을 때 로컬·TODO 블록이 허전해 보인다.
 * 모든 블록이 같은 자리에 띠를 갖되, 색으로 카테고리를 구분한다.
 * hue는 그대로 두고 밝기·채도만 바꾸므로 저장값은 건드리지 않는다 (원칙: 파생색은 저장 안 함).
 */
export function accentColor(baseColor: string | null | undefined): string {
  if (!baseColor) return BLOCK_ACCENT_FALLBACK
  const base = parseHsl(baseColor)
  return formatHsl({
    h: base.h,
    s: Math.max(base.s, BLOCK_ACCENT_MIN_SATURATION),
    l: BLOCK_ACCENT_LIGHTNESS,
  })
}

export function alternateLightness(baseColor: string, runIndex: number): string {
  const base = parseHsl(baseColor)
  if (runIndex % 2 === 0) return formatHsl(base)

  const step = base.l + CATEGORY_LIGHTNESS_STEP > 100 - CATEGORY_LIGHTNESS_STEP
    ? -CATEGORY_LIGHTNESS_STEP
    : CATEGORY_LIGHTNESS_STEP
  return formatHsl(shiftLightness(base, step))
}
