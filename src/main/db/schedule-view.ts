import type { DaySchedule, ScheduleData } from '@shared/ipc-contract'
import type { DateStr } from '@shared/types'
import { getLogicalDate, resolveAnchor } from '@shared/scheduler'
import { googleBlockColor } from '@shared/google-colors'
import { getAllSettings } from '@main/db/repositories/settings'
import {
  listAnchors,
  listGoogleEvents,
  listLocalEvents,
  listTodoSlots,
  listTodosForView,
} from '@main/db/repositories/schedule'

/**
 * 화면(과 채팅)이 쓰는 하루치 원본 데이터를 한 번에 읽는다.
 *
 * 표시 시각은 여기서 계산하지 않는다 — 호출자가 `layoutDay`로 만든다.
 * (렌더러는 드래그 미리보기 때문에, 채팅은 모델에게 시각을 보여주기 위해 각자 부른다)
 */
export function loadScheduleData(dates: DateStr[]): ScheduleData {
  const settings = getAllSettings()

  const anchorByDate = new Map(listAnchors(dates).map((a) => [a.date, a]))
  const localByDate = groupBy(listLocalEvents(dates), (r) => r.date)
  const googleByDate = groupBy(listGoogleEvents(dates), (r) => r.date)
  const slotsByDate = groupBy(listTodoSlots(dates), (r) => r.date)

  const days: DaySchedule[] = dates.map((date) => {
    const override = anchorByDate.get(date)
    return {
      date,
      anchorTime: resolveAnchor(date, override, settings.weekdayAnchorTimes),
      anchorIsOverride: override !== undefined,
      queue: (localByDate.get(date) ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        durationMinutes: r.duration_minutes,
        categoryId: r.category_id,
        meta: { isHeld: r.is_held === 1, completed: r.completed === 1 },
      })),
      googleEvents: (googleByDate.get(date) ?? [])
        .filter((r) => r.is_all_day === 0)
        .map((r) => ({
          id: r.google_event_id,
          title: r.title,
          startTime: r.start_time,
          endTime: r.end_time,
          categoryId: null,
          meta: {
            isHeld: r.is_held === 1,
            googleColor: googleBlockColor(r.color_id, r.calendar_color),
          },
        })),
      allDayEvents: (googleByDate.get(date) ?? [])
        .filter((r) => r.is_all_day === 1)
        .map((r) => ({ id: r.google_event_id, title: r.title })),
      todoSlots: (slotsByDate.get(date) ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        startTime: r.start_time,
        endTime: r.end_time,
        categoryId: r.category_id,
        meta: { todoId: r.todo_id, completed: r.completed === 1 },
      })),
    }
  })

  const rows = listTodosForView(dates)

  return {
    today: getLogicalDate(new Date(), settings.dayStartHour),
    days,
    googleEvents: [...googleByDate.values()].flat().map((r) => ({
      id: r.google_event_id,
      title: r.title,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      description: r.description,
      location: r.location,
      isAllDay: r.is_all_day === 1,
      isRecurring: r.is_recurring === 1,
    })),
    todos: rows.map((t) => ({
      id: t.id,
      title: t.title,
      categoryId: t.category_id,
      completed: t.completed === 1,
      deadline: t.deadline_computed,
      deadlineType: t.deadline_type,
      deadlineRelativeDays: t.deadline_relative_days,
      description: t.description,
      url: t.url,
    })),
    backlogIds: rows.filter((t) => t.placed === 0).map((t) => t.id),
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const bucket = map.get(k)
    if (bucket) bucket.push(row)
    else map.set(k, [row])
  }
  return map
}
