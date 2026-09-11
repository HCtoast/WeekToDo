import type { TimeStr } from '@shared/types'

/**
 * 계산 엔진의 입출력 타입.
 * DB 행 타입을 그대로 받지 않는다 — 엔진이 스키마를 모르게 두면
 * 테스트가 짧아지고, 나중에 컬럼이 바뀌어도 어댑터만 고치면 된다.
 */

export type BlockKind = 'local' | 'google' | 'todo'

/**
 * 배치 계산에는 쓰이지 않고 그대로 통과만 하는 부가 상태.
 * 엔진이 이 값들을 해석하지 않으므로 계산 로직은 계속 순수하게 유지된다.
 */
export interface BlockMeta {
  isHeld?: boolean
  completed?: boolean
  /** TODO 슬롯이 가리키는 원본 TODO */
  todoId?: string
  /**
   * 구글 일정의 블록 배경색 (`hsl(...)`).
   *
   * 카테고리처럼 id로 찾는 게 아니라 구글에서 온 색을 그 자리에서 눌러 만든 값이라
   * 여기 실어 나른다 — 레이아웃 엔진은 색을 모른다.
   */
  googleColor?: string
}

/** 앵커 기준 상대 큐 항목. 절대 시각이 없다. */
export interface QueueItem {
  id: string
  title: string
  durationMinutes: number
  categoryId?: string | null
  meta?: BlockMeta
}

/** 절대 시각이 고정된 항목 (구글 이벤트, TODO 슬롯). */
export interface FixedBlock {
  id: string
  title: string
  startTime: TimeStr
  endTime: TimeStr
  categoryId?: string | null
  meta?: BlockMeta
}

export interface PlacedBlock {
  kind: BlockKind
  id: string
  title: string
  /** 논리적 하루 시작으로부터의 분. 렌더링 좌표는 이 값으로 계산한다. */
  startOffset: number
  endOffset: number
  /** 표시용 */
  startTime: TimeStr
  endTime: TimeStr
  categoryId: string | null
  meta: BlockMeta
  /**
   * 겹치는 블록을 나란히 놓기 위한 열 번호 (0부터).
   *
   * 열은 **종류를 섞지 않고** 배정된다 — 구글·로컬이 한 무리, TODO가 따로 한 무리다.
   * 그래서 TODO가 구글 위에 얹혀도 구글은 폭을 잃지 않는다.
   */
  column: number
  /** 같은 겹침 무리의 열 개수. 블록 폭 = 1 / columnCount */
  columnCount: number
  /**
   * TODO 슬롯이 다른 블록 위에 얹혔으면 1, 아니면 0. 다른 종류는 항상 0이다.
   *
   * 한 칸 밀어 아래 블록의 왼쪽 색 띠가 드러나게 하려는 값이다.
   * TODO끼리 겹치는 경우는 이 값이 아니라 `column`이 나란히 나눠 맡는다.
   */
  stackIndex: number
  /** 같은 카테고리가 연속될 때의 위치. 명도 교차 렌더링에 쓴다. */
  runIndex: number
}

export interface LayoutInput {
  /** resolveAnchor가 돌려준 값. null이 될 수 없다. */
  anchorTime: TimeStr
  dayStartHour: number
  /** order_index 오름차순으로 정렬되어 있어야 한다 */
  queue: QueueItem[]
  googleEvents: FixedBlock[]
  todoSlots: FixedBlock[]
}

export interface LayoutResult {
  /** startOffset 오름차순 */
  blocks: PlacedBlock[]
  /** 하루 경계를 넘어 다음 날 큐로 이월될 항목 (원래 순서 유지) */
  overflow: QueueItem[]
}
