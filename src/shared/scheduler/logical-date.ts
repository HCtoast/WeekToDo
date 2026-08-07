import type { DateStr } from '@shared/types'
import type { WeekStartMode, Weekday } from '@shared/settings-schema'
import { addDays, weekdayOf } from '@shared/scheduler/time'

/**
 * 논리적 날짜. `now.getDate()`를 직접 쓰지 않고 반드시 이 함수를 거친다.
 * dayStartHour=6이면 새벽 3시는 아직 "어제"다.
 */
export function getLogicalDate(now: Date, dayStartHour: number): DateStr {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const shift = now.getHours() < dayStartHour ? -1 : 0
  const utc = new Date(Date.UTC(y, m, d + shift))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
    utc.getUTCDate(),
  ).padStart(2, '0')}`
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 두 논리적 날짜 사이의 일수. 정오 기준으로 재서 서머타임에 흔들리지 않는다. */
export function daysBetween(from: DateStr, to: DateStr): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY)
}

const RELATIVE_KO: Record<number, string> = {
  [-2]: '그저께',
  [-1]: '어제',
  0: '오늘',
  1: '내일',
  2: '모레',
  3: '글피',
}

/**
 * 논리적 오늘로부터의 거리를 사람 말로 바꾼다 (어제 · 오늘 · 내일 …).
 *
 * 채팅 스냅샷이 날짜마다 이 라벨을 달고 나간다. 모델에게 날짜 산술을 시키면
 * **벽시계 날짜를 기준으로 더해서 하루씩 밀린다** — 8월 6일 새벽 2시는 논리적으로
 * 아직 8월 5일이므로 그때의 "내일"은 8월 7일이 아니라 8월 6일이다.
 */
export function relativeDayLabel(today: DateStr, date: DateStr): string {
  const offset = daysBetween(today, date)
  return RELATIVE_KO[offset] ?? (offset > 0 ? `${offset}일 뒤` : `${-offset}일 전`)
}

const FIXED_START: Partial<Record<WeekStartMode, Weekday>> = {
  saturday: 'sat',
  sunday: 'sun',
  monday: 'mon',
}

const WEEKDAY_ORDER: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * 큰 위젯이 보여줄 7일.
 *
 * - 요일 고정(`saturday`/`sunday`/`monday`): 오늘로부터 가장 가까운 과거(또는 오늘)의 해당 요일부터
 * - 롤링(`today`/`yesterday`): 매일 창이 한 칸씩 밀린다 — "이번 주"라는 고정 개념이 없다
 */
export function getWeekRange(today: DateStr, mode: WeekStartMode): DateStr[] {
  let start: DateStr

  if (mode === 'today') {
    start = today
  } else if (mode === 'yesterday') {
    start = addDays(today, -1)
  } else {
    const target = FIXED_START[mode]!
    const diff = WEEKDAY_ORDER.indexOf(weekdayOf(today)) - WEEKDAY_ORDER.indexOf(target)
    start = addDays(today, -((diff + 7) % 7))
  }

  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/**
 * 작은 위젯은 오늘 + 내일 고정이다.
 * weekStartMode는 큰 위젯 전용이므로 여기서 참조하지 않는다.
 */
export function getSmallWidgetRange(today: DateStr): DateStr[] {
  return [today, addDays(today, 1)]
}
