import type { DateStr } from '@shared/types'
import {
  addDays,
  getLogicalDate,
  planQueueRollover,
  planSlotRollover,
  resolveAnchor,
  type DayQueue,
  type PendingSlot,
} from '@shared/scheduler'
import { getDb } from '@main/db/client'
import { getAllSettings } from '@main/db/repositories/settings'
import * as schedule from '@main/db/repositories/schedule'

/**
 * 하루 경계 이월.
 *
 * 앱이 며칠 꺼져 있었어도 켜는 순간 한 번에 따라잡는다 — 경계를 넘을 때만 도는 잡이라면
 * 꺼져 있던 날의 이월이 통째로 누락된다.
 */
export interface RolloverResult {
  today: DateStr
  movedSlots: number
  movedEvents: number
}

/** 이월 대상이 될 수 있는 가장 이른 날짜. 없으면 할 일이 없다. */
function earliestPendingDate(today: DateStr): DateStr | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(d) AS earliest FROM (
         SELECT MIN(s.date) AS d
           FROM todo_time_slots s
           JOIN todos t ON t.id = s.todo_id
          WHERE s.date < ? AND t.completed = 0
         UNION ALL
         SELECT MIN(date) AS d FROM local_events WHERE date < ?
       )`,
    )
    .get(today, today) as { earliest: string | null }

  return row.earliest
}

export function runRollover(now = new Date()): RolloverResult {
  const settings = getAllSettings()
  const today = getLogicalDate(now, settings.dayStartHour)
  const earliest = earliestPendingDate(today)

  if (earliest === null) return { today, movedSlots: 0, movedEvents: 0 }

  // 이월 대상 날짜부터 오늘까지 연속으로 훑는다. 중간에 데이터가 없는 날도 앵커는 있으므로
  // (요일 기본값에서 파생) 큐 계산의 연쇄가 끊기지 않는다.
  const dates: DateStr[] = []
  for (let d = earliest; d <= today; d = addDays(d, 1)) dates.push(d)

  const anchorByDate = new Map(schedule.listAnchors(dates).map((a) => [a.date, a]))
  const anchorOf = (date: DateStr): string =>
    resolveAnchor(date, anchorByDate.get(date), settings.weekdayAnchorTimes)

  // ── 로컬 큐: 하루 경계를 넘어간 항목을 다음 날 맨 앞으로 ──────────────────
  const localByDate = new Map<DateStr, ReturnType<typeof schedule.listLocalEvents>>()
  for (const row of schedule.listLocalEvents(dates)) {
    const bucket = localByDate.get(row.date)
    if (bucket) bucket.push(row)
    else localByDate.set(row.date, [row])
  }
  const googleByDate = new Map<DateStr, ReturnType<typeof schedule.listGoogleEvents>>()
  for (const row of schedule.listGoogleEvents(dates)) {
    const bucket = googleByDate.get(row.date)
    if (bucket) bucket.push(row)
    else googleByDate.set(row.date, [row])
  }

  const days: DayQueue[] = dates.map((date) => ({
    date,
    anchorTime: anchorOf(date),
    queue: (localByDate.get(date) ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      durationMinutes: r.duration_minutes,
      categoryId: r.category_id,
    })),
    // 종일 일정은 장애물이 아니다 — 넣으면 하루 전체가 막혀 큐가 통째로 이월된다.
    googleEvents: (googleByDate.get(date) ?? [])
      .filter((r) => r.is_all_day === 0)
      .map((r) => ({
        id: r.google_event_id,
        title: r.title,
        startTime: r.start_time,
        endTime: r.end_time,
      })),
  }))

  const queuePlan = planQueueRollover(days, settings.dayStartHour)

  // ── TODO 슬롯: 미완료면 오늘 앵커에 붙인다 ────────────────────────────────
  const pending = getDb()
    .prepare(
      `SELECT s.id, s.date, s.start_time, s.end_time
         FROM todo_time_slots s
         JOIN todos t ON t.id = s.todo_id
        WHERE s.date < ? AND t.completed = 0`,
    )
    .all(today) as { id: string; date: string; start_time: string; end_time: string }[]

  const slotMoves = planSlotRollover({
    today,
    todayAnchor: anchorOf(today),
    dayStartHour: settings.dayStartHour,
    pending: pending.map(
      (p): PendingSlot => ({
        id: p.id,
        date: p.date,
        startTime: p.start_time,
        endTime: p.end_time,
      }),
    ),
  })

  // 계산이 끝난 뒤 한 트랜잭션으로 적용한다 — 중간에 실패해도 반쯤 옮겨진 상태가 남지 않는다.
  getDb().transaction(() => {
    for (const move of queuePlan.moves) {
      getDb()
        .prepare('UPDATE local_events SET date = ?, updated_at = ? WHERE id = ?')
        .run(move.date, new Date().toISOString(), move.id)
    }
    for (const order of queuePlan.orders) {
      schedule.reorderLocalEvents(order.date, order.orderedIds)
    }
    for (const move of slotMoves) {
      schedule.updateTodoSlot(move.id, {
        date: move.date,
        startTime: move.startTime,
        endTime: move.endTime,
      })
    }
  })()

  return { today, movedSlots: slotMoves.length, movedEvents: queuePlan.moves.length }
}
