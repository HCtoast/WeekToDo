import { calendar, type calendar_v3 } from '@googleapis/calendar'
import {
  GOOGLE_SYNC_FUTURE_DAYS,
  GOOGLE_SYNC_PAST_DAYS,
} from '@shared/constants'
import { addDays, getLogicalDate } from '@shared/scheduler'
import type { DateStr, TimeStr } from '@shared/types'
import { getAuthorizedClient } from '@main/google/auth'
import { getAllSettings } from '@main/db/repositories/settings'
import { replaceGoogleEvents, type GoogleEventInput } from '@main/db/repositories/schedule'

export interface CalendarInfo {
  id: string
  summary: string
  primary: boolean
  backgroundColor: string | null
}

function api(): calendar_v3.Calendar {
  return calendar({ version: 'v3', auth: getAuthorizedClient() })
}

export async function listCalendars(): Promise<CalendarInfo[]> {
  const res = await api().calendarList.list({ maxResults: 250 })
  return (res.data.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id!,
      summary: c.summaryOverride ?? c.summary ?? c.id!,
      primary: c.primary === true,
      backgroundColor: c.backgroundColor ?? null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary))
}

function timeOf(iso: string): TimeStr {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 구글 이벤트 하나를 캐시 행으로 바꾼다.
 *
 * 종일 일정이 여러 날에 걸치면 날짜별로 쪼갠다. 그러지 않으면 첫날에만 보이고
 * "예비군 3일"의 둘째·셋째 날이 화면에서 사라진다.
 * 쪼갠 행의 id는 `원본id::날짜` 형태다 — 원본 이벤트를 수정할 때 앞부분만 떼어 쓴다.
 */
function toRows(event: calendar_v3.Schema$Event, dayStartHour: number): GoogleEventInput[] {
  const id = event.id
  if (!id || event.status === 'cancelled') return []

  const base = {
    calendarId: '',
    title: event.summary ?? '(제목 없음)',
    description: event.description ?? null,
    location: event.location ?? null,
    isRecurring: event.recurringEventId !== undefined && event.recurringEventId !== null,
    recurrenceRule: event.recurrence?.join('\n') ?? null,
  }

  // 종일 일정: start.date ~ end.date (end는 배타적)
  if (event.start?.date && event.end?.date) {
    const rows: GoogleEventInput[] = []
    for (let d = event.start.date; d < event.end.date; d = addDays(d, 1)) {
      const multiDay = addDays(event.start.date, 1) < event.end.date
      rows.push({
        ...base,
        googleEventId: multiDay ? `${id}::${d}` : id,
        date: d,
        startTime: '00:00',
        endTime: '00:00',
        isAllDay: true,
      })
    }
    return rows
  }

  if (!event.start?.dateTime || !event.end?.dateTime) return []

  return [
    {
      ...base,
      googleEventId: id,
      // 시각이 있는 일정은 논리적 날짜에 매단다 — 새벽 1시 일정은 "어제" 칸에 있어야 한다.
      date: getLogicalDate(new Date(event.start.dateTime), dayStartHour),
      startTime: timeOf(event.start.dateTime),
      endTime: timeOf(event.end.dateTime),
      isAllDay: false,
    },
  ]
}

export interface SyncResult {
  calendars: number
  events: number
  from: DateStr
  to: DateStr
}

/**
 * 선택된 캘린더의 이벤트를 받아 캐시를 통째로 갈아끼운다.
 *
 * `singleEvents: true`로 반복 일정을 이미 전개된 인스턴스로 받는다 — RRULE을 직접 펼치지 않는다.
 */
export async function syncGoogleEvents(now = new Date()): Promise<SyncResult> {
  const settings = getAllSettings()
  const today = getLogicalDate(now, settings.dayStartHour)
  const from = addDays(today, -GOOGLE_SYNC_PAST_DAYS)
  const to = addDays(today, GOOGLE_SYNC_FUTURE_DAYS)

  const calendarIds = settings.googleCalendarIds
  if (calendarIds.length === 0) {
    replaceGoogleEvents([], from, to)
    return { calendars: 0, events: 0, from, to }
  }

  const client = api()
  const rows: GoogleEventInput[] = []

  for (const calendarId of calendarIds) {
    let pageToken: string | undefined
    do {
      const res = await client.events.list({
        calendarId,
        timeMin: new Date(`${from}T00:00:00`).toISOString(),
        timeMax: new Date(`${to}T23:59:59`).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken,
      })
      for (const event of res.data.items ?? []) {
        for (const row of toRows(event, settings.dayStartHour)) {
          rows.push({ ...row, calendarId })
        }
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  replaceGoogleEvents(rows, from, to)
  return { calendars: calendarIds.length, events: rows.length, from, to }
}
