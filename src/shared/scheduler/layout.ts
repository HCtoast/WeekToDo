import { MINUTES_PER_DAY, fromDayOffset, toDayOffset } from '@shared/scheduler/time'
import type {
  BlockKind,
  BlockMeta,
  FixedBlock,
  LayoutInput,
  LayoutResult,
  PlacedBlock,
  QueueItem,
} from '@shared/scheduler/types'

interface Interval {
  start: number
  end: number
}

/**
 * 절대 시각 블록을 하루 좌표계 구간으로 바꾼다.
 *
 * 종료가 시작보다 앞이면 하루 경계를 넘는 이벤트다(예: dayStartHour=6에 05:00~07:00).
 * 이 경우 이 날짜 몫만 잘라 하루 끝까지로 본다 — 나머지는 다음 논리적 날짜의 항목으로
 * 따로 들어오는 것이 동기화 계층의 책임이다.
 */
function toInterval(block: FixedBlock, dayStartHour: number): Interval {
  const start = toDayOffset(block.startTime, dayStartHour)
  const rawEnd = toDayOffset(block.endTime, dayStartHour)
  return { start, end: rawEnd <= start ? MINUTES_PER_DAY : rawEnd }
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * 구글 이벤트는 절대 밀리지 않는 고정 장애물이다.
 * 커서를 놓았을 때 겹치는 장애물이 있으면 그 장애물이 끝나는 시각으로 건너뛰고,
 * 더 이상 겹치는 것이 없을 때까지 반복한다(연달아 붙어 있는 장애물 대응).
 *
 * 겹침 조건이 `장애물 끝 > 커서`를 함의하므로 커서는 매번 반드시 증가한다 — 무한 루프가 없다.
 */
function skipObstacles(from: number, duration: number, obstacles: Interval[]): number {
  let cursor = from
  let moved = true

  while (moved) {
    moved = false
    for (const o of obstacles) {
      if (overlaps({ start: cursor, end: cursor + duration }, o)) {
        cursor = o.end
        moved = true
      }
    }
  }

  return cursor
}

function makeBlock(
  kind: BlockKind,
  source: { id: string; title: string; categoryId?: string | null; meta?: BlockMeta },
  interval: Interval,
  dayStartHour: number,
): PlacedBlock {
  return {
    kind,
    id: source.id,
    title: source.title,
    startOffset: interval.start,
    endOffset: interval.end,
    startTime: fromDayOffset(interval.start, dayStartHour),
    endTime: fromDayOffset(interval.end, dayStartHour),
    categoryId: source.categoryId ?? null,
    meta: source.meta ?? {},
    column: 0,
    columnCount: 1,
    stackIndex: 0,
    runIndex: 0,
  }
}

/**
 * 서로 겹치는 블록에 열을 배정한다 (Google Calendar와 같은 방식).
 *
 * 겹치는 것들을 하나의 무리로 묶고, 무리 안에서 "이미 끝난 열"을 재사용한다.
 * 화면에서 블록 폭은 `1 / columnCount`, 위치는 `column / columnCount`가 된다.
 *
 * @param blocks **같은 종류끼리만 모은** startOffset 오름차순 배열
 */
function assignColumnsWithin(blocks: PlacedBlock[]): void {
  let group: PlacedBlock[] = []
  let groupEnd = -1

  const flush = (): void => {
    if (group.length === 0) return

    const columnEnds: number[] = []
    for (const b of group) {
      let column = columnEnds.findIndex((end) => end <= b.startOffset)
      if (column === -1) {
        column = columnEnds.length
        columnEnds.push(b.endOffset)
      } else {
        columnEnds[column] = b.endOffset
      }
      b.column = column
    }
    for (const b of group) b.columnCount = columnEnds.length

    group = []
    groupEnd = -1
  }

  for (const b of blocks) {
    if (group.length > 0 && b.startOffset >= groupEnd) flush()
    group.push(b)
    groupEnd = Math.max(groupEnd, b.endOffset)
  }
  flush()
}

/**
 * 열 배정은 **종류를 섞지 않는다.** 구글·로컬이 한 무리, TODO가 따로 한 무리다.
 *
 * TODO를 구글과 같은 무리에 넣으면 "수업 시간에 과제를 얹는" 정상적인 사용에서 둘 다
 * 반쪽이 된다. TODO는 구글과 폭을 나누는 관계가 아니라 **위에 얹히는** 관계다
 * (설계 원칙 3 — 구글은 고정 장애물이고 폭을 잃지 않는다). 얹힐 때 아래가 완전히
 * 가려지지 않도록 `assignStackIndex`가 한 칸 민다.
 *
 * TODO끼리는 나란히 나눈다. 예전에는 이것도 계단처럼 밀어 쌓았는데, 미는 만큼 폭이 줄어
 * 오른쪽 끝이 맞춰지는 탓에 뒤 블록이 앞 블록 **안에** 들어앉았다 — 앞 블록의 시각 글자가
 * 베이고, 남의 구간에 완전히 포함된 TODO는 실오라기만 남아 아예 읽을 수 없었다.
 * 나란히 놓으면 좁아지는 대신 서로를 가리지 않는다.
 */
function assignColumns(blocks: PlacedBlock[]): void {
  assignColumnsWithin(blocks.filter((b) => b.kind !== 'todo'))
  assignColumnsWithin(blocks.filter((b) => b.kind === 'todo'))
}

/**
 * 다른 블록 위에 얹힌 TODO 슬롯을 한 칸 민다.
 *
 * 전폭으로 얹으면 아래 구글 일정을 통째로 덮어 "그 시간에 뭐가 있었는지"가 사라진다.
 * 한 칸만 밀어도 아래 블록의 왼쪽 색 띠가 드러나 존재가 읽힌다.
 *
 * TODO끼리의 겹침은 여기서 다루지 않는다 — `assignColumns`가 나란히 나눈다.
 */
function assignStackIndex(blocks: PlacedBlock[]): void {
  const fixed = blocks.filter((b) => b.kind !== 'todo')

  for (const b of blocks) {
    if (b.kind !== 'todo') continue

    b.stackIndex = fixed.some((f) => f.startOffset < b.endOffset && b.startOffset < f.endOffset)
      ? 1
      : 0
  }
}

/**
 * 같은 카테고리가 연속으로 이어질 때 몇 번째인지 매긴다.
 * 렌더링에서 이 값으로 명도를 교차시켜 "게임1 / 게임2"의 경계를 보이게 한다.
 */
function assignRunIndex(blocks: PlacedBlock[]): void {
  let previousCategory: string | null = null
  let run = 0

  for (const b of blocks) {
    run = b.categoryId !== null && b.categoryId === previousCategory ? run + 1 : 0
    b.runIndex = run
    previousCategory = b.categoryId
  }
}

/**
 * 하루치 배치를 계산한다. 순수 함수 — 같은 입력이면 항상 같은 결과.
 *
 * 로컬 큐는 앵커에서 시작해 소요시간을 누적하며 놓이고, 구글 이벤트를 만나면 그 뒤로 밀린다.
 * 하루 경계를 넘는 항목은 배치하지 않고 `overflow`로 넘긴다 (다음 날 큐로 이월하는 것은 호출자 몫).
 */
export function layoutDay(input: LayoutInput): LayoutResult {
  const { anchorTime, dayStartHour, queue, googleEvents, todoSlots } = input

  const obstacles = googleEvents
    .map((g) => toInterval(g, dayStartHour))
    .sort((a, b) => a.start - b.start)

  const blocks: PlacedBlock[] = [
    ...googleEvents.map((g) => makeBlock('google', g, toInterval(g, dayStartHour), dayStartHour)),
    ...todoSlots.map((t) => makeBlock('todo', t, toInterval(t, dayStartHour), dayStartHour)),
  ]

  const overflow: QueueItem[] = []
  let cursor = toDayOffset(anchorTime, dayStartHour)

  for (const [index, item] of queue.entries()) {
    if (item.durationMinutes <= 0) {
      throw new Error(`소요시간은 양수여야 합니다: ${item.id} = ${item.durationMinutes}`)
    }

    cursor = skipObstacles(cursor, item.durationMinutes, obstacles)

    // 한 항목이라도 하루 경계를 넘으면 그 뒤는 전부 다음 날로 넘긴다.
    // 뒷 항목만 골라 끼워 넣으면 사용자가 정한 순서가 뒤집힌다.
    if (cursor + item.durationMinutes > MINUTES_PER_DAY) {
      overflow.push(...queue.slice(index))
      break
    }

    blocks.push(
      makeBlock('local', item, { start: cursor, end: cursor + item.durationMinutes }, dayStartHour),
    )
    cursor += item.durationMinutes
  }

  // 시작이 같으면 **긴 것을 먼저** 놓는다. 열 배정이 이 순서를 따르므로,
  // 짧은 것을 먼저 놓으면 긴 이벤트가 오른쪽 열로 밀려나 감싸는 일정이 곁가지처럼 보인다.
  // 마지막에 id를 두는 이유: 완전히 같은 구간의 순서가 실행마다 달라지면
  // 열 배정과 명도 교차 결과가 흔들려 화면이 깜빡인다.
  blocks.sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset || a.id.localeCompare(b.id),
  )

  assignColumns(blocks)
  assignStackIndex(blocks)
  assignRunIndex(blocks)

  return { blocks, overflow }
}
