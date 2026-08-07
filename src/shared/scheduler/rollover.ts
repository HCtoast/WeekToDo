import type { DateStr, TimeStr } from '@shared/types'
import { MINUTES_PER_DAY, fromDayOffset, parseTime, toDayOffset } from '@shared/scheduler/time'
import { layoutDay } from '@shared/scheduler/layout'
import type { FixedBlock, QueueItem } from '@shared/scheduler/types'

/**
 * 하루 경계를 넘길 때의 이월 계획을 세운다. 순수 함수 — DB를 건드리지 않고 "무엇을 어디로"만 돌려준다.
 *
 * 계산과 적용을 나눈 이유: 며칠 밀린 경우까지 포함해 결과를 테스트로 고정할 수 있고,
 * 실제 UPDATE는 메인의 잡이 트랜잭션 하나로 처리하면 되기 때문.
 */

// ── TODO 슬롯 이월 ───────────────────────────────────────────────────────────

export interface PendingSlot {
  id: string
  /** 원래 날짜 (today보다 과거) */
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
}

export interface SlotMove {
  id: string
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
}

/** 자정을 넘는 슬롯도 있으므로 감아서 계산한다. */
function durationOf(slot: PendingSlot): number {
  const raw = (((parseTime(slot.endTime) - parseTime(slot.startTime)) % MINUTES_PER_DAY) +
    MINUTES_PER_DAY) %
    MINUTES_PER_DAY
  return Math.max(1, raw)
}

/**
 * 미완료 TODO 슬롯을 오늘 앵커에 붙인다.
 *
 * - 원래 소요시간을 유지한다.
 * - 여러 개면 앵커부터 **순차로 이어 붙인다**. 전부 같은 시각에 겹쳐두면 폭이 1/N로 쪼개져
 *   읽을 수 없다 — 겹침 허용은 사용자가 의도해서 만든 겹침에 대한 규칙이지,
 *   자동 이월이 겹침을 양산할 이유는 없다.
 * - 오래된 것부터 앞에 온다. 가장 오래 미룬 일이 제일 먼저 눈에 띄어야 한다.
 */
export function planSlotRollover(input: {
  today: DateStr
  todayAnchor: TimeStr
  dayStartHour: number
  pending: PendingSlot[]
}): SlotMove[] {
  const { today, todayAnchor, dayStartHour, pending } = input

  const ordered = [...pending].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      toDayOffset(a.startTime, dayStartHour) - toDayOffset(b.startTime, dayStartHour) ||
      a.id.localeCompare(b.id),
  )

  let cursor = toDayOffset(todayAnchor, dayStartHour)

  return ordered.map((slot) => {
    const duration = durationOf(slot)
    // 쌓다가 하루 끝을 넘으면 더 밀지 않는다. 넘겨봐야 다음 논리적 날짜로 감겨
    // "오늘 이월분"이라는 의미가 깨진다. 남은 것들은 하루 끝에 겹쳐 쌓인다.
    const start = Math.min(cursor, MINUTES_PER_DAY - duration)
    cursor = start + duration

    return {
      id: slot.id,
      date: today,
      startTime: fromDayOffset(start, dayStartHour),
      endTime: fromDayOffset(start + duration, dayStartHour),
    }
  })
}

// ── 로컬 큐 이월 (하루 경계 초과분) ───────────────────────────────────────────

export interface DayQueue {
  date: DateStr
  anchorTime: TimeStr
  /** order_index 오름차순 */
  queue: QueueItem[]
  googleEvents: FixedBlock[]
}

export interface QueueRolloverPlan {
  /** 항목이 옮겨갈 날짜 */
  moves: { id: string; date: DateStr }[]
  /** 순서가 바뀐 날짜의 최종 순서 */
  orders: { date: DateStr; orderedIds: string[] }[]
}

/**
 * 하루 경계를 넘어간 로컬 이벤트를 다음 날 큐의 **맨 앞**으로 옮긴다.
 *
 * `days`는 날짜 오름차순이며 마지막이 오늘이다. 오늘의 초과분은 옮기지 않는다 —
 * 오늘은 아직 끝나지 않았고, 앵커를 뒤로 미루거나 항목을 줄이면 다시 들어올 수 있다.
 *
 * 앞 날짜부터 처리하므로 며칠 밀린 경우도 자연히 연쇄된다
 * (D-3의 초과분이 D-2로 가고, 그래서 D-2가 다시 넘치면 D-1로).
 */
export function planQueueRollover(days: DayQueue[], dayStartHour: number): QueueRolloverPlan {
  const queues = new Map(days.map((d) => [d.date, [...d.queue]]))
  const moves: { id: string; date: DateStr }[] = []
  const changed = new Set<DateStr>()

  for (let i = 0; i < days.length - 1; i++) {
    const day = days[i]!
    const next = days[i + 1]!
    const queue = queues.get(day.date)!

    const { overflow } = layoutDay({
      anchorTime: day.anchorTime,
      dayStartHour,
      queue,
      googleEvents: day.googleEvents,
      todoSlots: [],
    })
    if (overflow.length === 0) continue

    const overflowIds = new Set(overflow.map((o) => o.id))
    queues.set(
      day.date,
      queue.filter((q) => !overflowIds.has(q.id)),
    )
    queues.set(next.date, [...overflow, ...queues.get(next.date)!])

    for (const item of overflow) moves.push({ id: item.id, date: next.date })
    changed.add(day.date)
    changed.add(next.date)
  }

  return {
    moves,
    orders: [...changed]
      .sort()
      .map((date) => ({ date, orderedIds: queues.get(date)!.map((q) => q.id) })),
  }
}
