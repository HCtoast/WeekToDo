/**
 * 카테고리 팔레트 — 사용자가 만든 분류에 돌려 쓰는 색.
 *
 * 상태색(danger/warning/success/info)과 **역할이 다르다.** 상태색은 의미가 고정돼 있고,
 * 이건 의미 없는 라벨에 구분만 주는 용도다. "쇼핑" 카테고리는 warning이 아니다.
 *
 * ## 왜 HSL 문자열인가
 * CSS 토큰이 아니라 **데이터**다. DB에 저장되고, 사용자가 색을 바꾸고, 렌더링 시점에
 * 밝기를 파생시키는 식으로 쓰인다. 그래서 `hsl(H S% L%)` 문자열로 두어
 * 파싱·조작이 쉽게 했다.
 *
 * ## 밝기 66%로 통일한 이유
 * 블록 배경으로 깔고 그 위에 **검은 글자**(`BLOCK_TEXT_COLOR`)를 얹는 전제다.
 * 더 중요한 건 이 값이 `BLOCK_MIN_LIGHTNESS`(58%)보다 위라는 점이다 — 그 아래면
 * `ensureReadableBackground()`가 렌더링 때마다 조용히 밝혀서 **저장된 색과 보이는 색이
 * 달라진다.** 001의 시드 6개 중 5개가 그 상태였고 003에서 바로잡았다.
 * 밝기를 한 값으로 통일해야 여러 카테고리가 나란히 있을 때 하나만 튀지 않는다.
 *
 * ## 채도를 낮게 잡은 이유
 * 이 위젯은 유리 배경 위에 얹히는 **배경형 도구**다. 채도가 높으면 블록이 화면 앞으로
 * 튀어나와, 정작 읽어야 할 제목·시간보다 색이 먼저 보인다. 구분은 hue가 하고 채도는 낮춘다.
 * 노랑·주황 계열(amber·lime)만 몇 %p 높다 — 같은 채도값에서 더 흐리게 보이기 때문.
 *
 * ## 원본과 다른 점
 * HCToast 레지스트리(`category-palette`)에서 가져왔지만 **값은 이 앱 기준으로 다시 잡았다.**
 * 원본은 L 62% / S 48~76%이고 여기는 L 66% / S 34~44%다. hue 계열만 그대로다.
 *
 * ## 여기 값과 DB
 * `003_category_palette.sql`이 시드 카테고리에 넣는 색이 **전부 이 표에서 나온다.**
 * 둘이 어긋나면 `category-palette.test.ts`가 깨진다 — 한쪽만 고치는 일을 막기 위함이다.
 */

/** 카테고리 배경의 기준 밝기(%). `BLOCK_MIN_LIGHTNESS`(58)보다 위여야 한다. */
export const CATEGORY_LIGHTNESS = 66

/** 생성기가 쓰는 기준 채도(%). 표에 있는 값들의 가운데. */
export const CATEGORY_SATURATION = 38

export interface CategoryColor {
  /** 안정적인 참조용 키 */
  readonly key: string
  /** 한국어 이름 (색 선택기에 그대로 쓸 수 있게) */
  readonly label: string
  /** `hsl(H S% L%)` 정규 형식 */
  readonly hsl: string
}

/**
 * 기본 8색. 이 이상 필요하면 `categoryColorAt()`이 hue를 만들어 늘린다.
 * 배열 순서는 **인접한 두 개가 최대한 안 닮도록** 섞어뒀다 — 위에서부터 자동 배정할 때
 * 바로 옆이 비슷하면 안 된다.
 */
export const CATEGORY_PALETTE: readonly CategoryColor[] = [
  { key: 'lime', label: '라임', hsl: 'hsl(74 44% 66%)' },
  { key: 'blue', label: '파랑', hsl: 'hsl(212 40% 66%)' },
  { key: 'rose', label: '로즈', hsl: 'hsl(352 38% 66%)' },
  { key: 'teal', label: '청록', hsl: 'hsl(168 34% 66%)' },
  { key: 'amber', label: '앰버', hsl: 'hsl(36 44% 66%)' },
  { key: 'violet', label: '보라', hsl: 'hsl(268 34% 66%)' },
  { key: 'sky', label: '하늘', hsl: 'hsl(194 36% 66%)' },
  { key: 'coral', label: '코랄', hsl: 'hsl(14 40% 66%)' },
] as const

/** 어디에도 속하지 않는 것(미분류·기타)의 무채색. */
export const CATEGORY_NEUTRAL: CategoryColor = {
  key: 'neutral',
  label: '회색',
  hsl: 'hsl(220 8% 66%)',
}

/**
 * 팔레트를 넘어서는 개수가 필요할 때 쓰는 hue 생성기.
 *
 * 황금각(137.5°)으로 돌린다. 균등 분할과 달리 몇 개를 뽑든 이미 뽑은 색과
 * 겹치지 않는다 — 카테고리가 몇 개까지 늘지 모를 때 쓰기 좋다.
 */
export function hueAt(index: number): number {
  /** 팔레트 첫 항목(라임)의 hue에서 출발한다. */
  const ANCHOR = 74
  return (ANCHOR + index * 137.5) % 360
}

/** `hueAt`으로 만든 hue를 팔레트와 같은 밝기/채도 규격의 색 문자열로. */
export function categoryColorAt(index: number): string {
  if (index < CATEGORY_PALETTE.length) return CATEGORY_PALETTE[index].hsl
  const h = Math.round(hueAt(index) * 10) / 10
  return `hsl(${h} ${CATEGORY_SATURATION}% ${CATEGORY_LIGHTNESS}%)`
}
