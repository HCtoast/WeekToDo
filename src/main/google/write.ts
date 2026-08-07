import { calendar, type calendar_v3 } from '@googleapis/calendar'
import { addDays } from '@shared/scheduler'
import type { DateStr, TimeStr } from '@shared/types'
import { getAuthorizedClient } from '@main/google/auth'
import { getClientCredentials, getRefreshToken } from '@main/google/credentials'
import { getDb } from '@main/db/client'
import { getSetting } from '@main/db/repositories/settings'

/**
 * 구글 캘린더 쓰기.
 *
 * 읽기(sync)는 캐시를 갈아끼우면 그만이지만, 쓰기는 **남의 서버 상태**를 바꾼다.
 * 그래서 여기서는 캐시를 직접 손대지 않는다 — 호출자가 쓰기 뒤에 동기화를 돌려
 * 구글이 실제로 저장한 값(시간대 보정, 반복 인스턴스 처리 등)을 그대로 받아온다.
 * 로컬에서 추측해 캐시에 써넣으면 다음 동기화에 조용히 뒤집힌다.
 *
 * 되돌리기도 이 구조가 공짜로 해준다: API가 실패하면 캐시는 손대지 않은 상태 그대로라
 * 화면이 다시 읽는 순간 원래 자리로 돌아간다.
 */

function api(): calendar_v3.Calendar {
  if (getClientCredentials() === null || getRefreshToken() === null) {
    throw new Error('구글 계정이 연결되어 있지 않습니다. 설정 > 구글 캘린더에서 먼저 연결하세요.')
  }
  return calendar({ version: 'v3', auth: getAuthorizedClient() })
}

/** 'YYYY-MM-DD' + 'HH:MM' → RFC3339. 로컬 오프셋을 직접 붙인다 */
function toRfc3339(date: DateStr, time: TimeStr): string {
  const local = new Date(`${date}T${time}:00`)
  if (Number.isNaN(local.getTime())) throw new Error(`시각을 읽을 수 없습니다: ${date} ${time}`)

  // toISOString()은 UTC라 그대로 보내면 9시간 어긋난다 (코드 컨벤션).
  const offset = -local.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const p = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${date}T${time}:00${sign}${p(offset / 60)}:${p(offset % 60)}`
}

/**
 * 논리적 날짜 + 시각을 **달력 날짜**로 되돌린다.
 *
 * 우리는 하루를 `dayStartHour`(기본 6시)에 자르므로, 새벽 2시 일정은 논리적으로 "어제"에
 * 매달려 있지만 달력상으로는 다음 날이다. 구글은 논리적 날짜를 모르니 여기서 풀어야 한다.
 */
function toCalendarDate(logicalDate: DateStr, time: TimeStr, dayStartHour: number): DateStr {
  return Number(time.slice(0, 2)) < dayStartHour ? addDays(logicalDate, 1) : logicalDate
}

/**
 * 시작·종료를 구글이 받는 절대 구간으로 바꾼다.
 *
 * 종료가 시작보다 앞서 보이면 **자정을 넘긴 것**이다 (23:00~00:00). 이걸 오류로 막으면
 * 밤늦게 시작하는 일정을 영영 못 고친다 — 종료 날짜를 하루 뒤로 넘겨서 표현한다.
 */
function toRange(
  logicalDate: DateStr,
  startTime: TimeStr,
  endTime: TimeStr,
  dayStartHour: number,
): { start: string; end: string } {
  if (endTime === startTime) throw new Error('시작과 종료가 같습니다.')

  const startDate = toCalendarDate(logicalDate, startTime, dayStartHour)
  const endDate = endTime > startTime ? startDate : addDays(startDate, 1)

  return {
    start: toRfc3339(startDate, startTime),
    end: toRfc3339(endDate, endTime),
  }
}

/**
 * 캐시 id에서 캘린더 id와 원본 이벤트 id를 찾는다.
 *
 * 여러 날에 걸친 종일 일정은 `원본id::날짜`로 쪼개 저장돼 있으므로 앞부분만 떼어 쓴다.
 */
function locate(cachedId: string): { calendarId: string; eventId: string; isAllDay: boolean } {
  const row = getDb()
    .prepare('SELECT calendar_id, is_all_day FROM google_event_cache WHERE google_event_id = ?')
    .get(cachedId) as { calendar_id: string; is_all_day: number } | undefined
  if (!row) throw new Error(`구글 일정을 찾을 수 없습니다: ${cachedId}`)

  return {
    calendarId: row.calendar_id,
    eventId: cachedId.split('::')[0]!,
    isAllDay: row.is_all_day === 1,
  }
}

/**
 * 이 앱에서 만든 일정의 알림.
 *
 * `useDefault: false`로 캘린더 기본 알림을 끄고 우리가 정한 것만 넣는다 — 캘린더마다
 * 기본값이 달라서, 그대로 두면 위젯에서 만든 일정의 알림이 제각각이 된다.
 * **이메일은 절대 넣지 않는다**: 위젯에서 툭툭 만드는 일정이 전부 메일로 오면 메일함이 잠긴다.
 */
function reminders(): calendar_v3.Schema$Event['reminders'] {
  const minutes = getSetting('googleReminderMinutes')
  return {
    useDefault: false,
    overrides: minutes === null ? [] : [{ method: 'popup', minutes }],
  }
}

/** 새 일정을 쓸 캘린더. 설정에서 고른 것 → 동기화 목록의 첫 번째 순. */
function writeCalendarId(): string {
  const chosen = getSetting('googleWriteCalendarId')
  const synced = getSetting('googleCalendarIds')

  if (chosen && synced.includes(chosen)) return chosen
  if (synced.length > 0) return synced[0]!
  throw new Error('동기화할 구글 캘린더를 하나도 고르지 않았습니다. 설정에서 먼저 선택하세요.')
}

export interface GoogleEventDraft {
  title: string
  /** 논리적 날짜 */
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
  description?: string | null
  location?: string | null
}

export async function createGoogleEvent(draft: GoogleEventDraft): Promise<void> {
  const range = toRange(draft.date, draft.startTime, draft.endTime, getSetting('dayStartHour'))

  await api().events.insert({
    calendarId: writeCalendarId(),
    requestBody: {
      summary: draft.title,
      description: draft.description ?? undefined,
      location: draft.location ?? undefined,
      start: { dateTime: range.start },
      end: { dateTime: range.end },
      reminders: reminders(),
    },
  })
}

/**
 * 구글에서 일정을 지운다.
 *
 * 이 앱이 하는 유일한 **되돌릴 수 없는** 조작이다. 그래서 호출부(우클릭 메뉴)에서
 * 반드시 한 번 더 확인을 받고, 자동 판단(밀림·이월·자연어 명령)은 절대 이 길로 오지 않는다.
 * 위젯에서 일정을 만들 수 있게 된 이상 지우는 길도 있어야 한다 —
 * 없으면 잘못 만든 일정을 고치러 매번 브라우저를 열어야 한다.
 */
export async function deleteGoogleEvent(cachedId: string): Promise<void> {
  const found = locate(cachedId)
  await api().events.delete({ calendarId: found.calendarId, eventId: found.eventId })
}

export interface GoogleEventPatch {
  title?: string
  date?: DateStr
  startTime?: TimeStr
  endTime?: TimeStr
  description?: string | null
  location?: string | null
}

/**
 * 기존 이벤트를 고친다.
 *
 * 시각은 시작/종료가 한 쌍이라, 한쪽만 주면 나머지는 구글에서 지금 값을 읽어 채운다.
 * 반쪽만 PATCH하면 종료가 시작보다 앞선 이벤트가 되어 구글이 통째로 거부한다.
 */
export async function patchGoogleEvent(
  cachedId: string,
  patch: GoogleEventPatch,
): Promise<void> {
  const found = locate(cachedId)
  const client = api()

  const body: calendar_v3.Schema$Event = {}
  if (patch.title !== undefined) body.summary = patch.title
  if (patch.description !== undefined) body.description = patch.description ?? ''
  if (patch.location !== undefined) body.location = patch.location ?? ''

  const movesTime =
    patch.date !== undefined || patch.startTime !== undefined || patch.endTime !== undefined

  if (movesTime) {
    if (found.isAllDay) {
      throw new Error('종일 일정의 시각은 위젯에서 바꿀 수 없습니다. 구글 캘린더에서 수정하세요.')
    }

    /*
     * 시작·종료는 한 쌍이라 한쪽만 주면 나머지를 채워야 한다.
     * 지금 값은 **캐시에서** 읽는다 — 캐시는 이미 논리적 날짜 + 'HH:MM'으로 정규화돼 있어
     * 구글에서 다시 받아 변환하는 것보다 어긋날 여지가 적고, 왕복도 한 번 줄어든다.
     */
    const now = getDb()
      .prepare(
        'SELECT date, start_time, end_time FROM google_event_cache WHERE google_event_id = ?',
      )
      .get(cachedId) as { date: DateStr; start_time: TimeStr; end_time: TimeStr } | undefined
    if (!now) throw new Error('현재 시각을 읽지 못해 수정하지 않았습니다.')

    const range = toRange(
      patch.date ?? now.date,
      patch.startTime ?? now.start_time,
      patch.endTime ?? now.end_time,
      getSetting('dayStartHour'),
    )
    body.start = { dateTime: range.start }
    body.end = { dateTime: range.end }
  }

  if (Object.keys(body).length === 0) return

  await client.events.patch({
    calendarId: found.calendarId,
    eventId: found.eventId,
    requestBody: body,
  })
}
