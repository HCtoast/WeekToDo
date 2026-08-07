import type { DateStr, TimeStr } from '@shared/types'
import type { Weekday } from '@shared/settings-schema'

export const MINUTES_PER_DAY = 1440

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'HH:MM' → 자정 기준 분 */
export function parseTime(time: TimeStr): number {
  const m = TIME_RE.exec(time)
  if (!m) throw new Error(`시각 형식이 아닙니다: ${time}`)
  return Number(m[1]) * 60 + Number(m[2])
}

/** 자정 기준 분 → 'HH:MM' (24시간을 넘으면 감아서 표기) */
export function formatTime(minutesFromMidnight: number): TimeStr {
  const m = ((Math.round(minutesFromMidnight) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * 'HH:MM' → 논리적 하루 시작(dayStartHour)으로부터의 분. 0 이상 1440 미만.
 *
 * 배치 계산은 전부 이 좌표계에서 한다. 자정 기준으로 계산하면
 * dayStartHour=6일 때 새벽 2시가 "어제 20시간째"라는 사실을 매번 따로 처리해야 하고,
 * 그 자리에서 부호 처리 실수가 난다.
 */
export function toDayOffset(time: TimeStr, dayStartHour: number): number {
  const offset = parseTime(time) - dayStartHour * 60
  return ((offset % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/** 하루 시작 기준 분 → 'HH:MM' */
export function fromDayOffset(offset: number, dayStartHour: number): TimeStr {
  return formatTime(offset + dayStartHour * 60)
}

/**
 * 단위로 올림한다. 06:40 + 30분 단위 → 07:00, 07:00은 그대로.
 * 부팅 자동 앵커가 쓴다. 23:50 → '00:00'으로 감긴다.
 */
export function snapUpToUnit(time: TimeStr, unitMinutes: number): TimeStr {
  if (unitMinutes <= 0) throw new Error(`올림 단위는 양수여야 합니다: ${unitMinutes}`)
  return formatTime(Math.ceil(parseTime(time) / unitMinutes) * unitMinutes)
}

/**
 * 가장 가까운 단위로 반올림한다. 드래그 이동/리사이즈가 `moveUnitMinutes` 격자에 붙게 한다.
 * 올림하는 `snapUpToUnit`과 달리 아래로도 붙으므로, 조금 당기면 당겨지고 조금 밀면 밀린다.
 */
export function snapToUnit(minutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0) throw new Error(`스냅 단위는 양수여야 합니다: ${unitMinutes}`)
  return Math.round(minutes / unitMinutes) * unitMinutes
}

/**
 * 'HH:MM'을 단위에 맞춰 반올림한다. 19:07 + 15분 단위 → 19:00.
 *
 * `<input type="time">`의 `step`은 폼 제출 때만 검사하므로 직접 입력한 값은 그대로 들어온다.
 * 저장 직전에 한 번 더 붙여야 실제로 단위가 지켜진다.
 */
export function snapTimeToUnit(time: TimeStr, unitMinutes: number): TimeStr {
  return formatTime(snapToUnit(parseTime(time), unitMinutes))
}

/**
 * 구간 길이 (분). 종료가 시작보다 앞서 보이면 다음 날로 본다 (23:00~00:00 = 60분).
 * 0이면 길이가 없는 것 — 정상적인 일정이 아니다.
 */
function rangeLength(start: TimeStr, end: TimeStr): number {
  return (((parseTime(end) - parseTime(start)) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY
}

/** 지금 구간이 자정을 넘는가 (23:00~00:00) */
function crossesMidnight(start: TimeStr, end: TimeStr): boolean {
  return parseTime(end) < parseTime(start)
}

/**
 * 시작 시각을 바꾼다. **길이가 0 이하로 뒤집힐 때만** 종료를 함께 민다.
 *
 * 15:00~16:00에서 시작을 16:00이나 17:00으로 올리면 "시작이 종료를 넘었다"고 막는 대신
 * 길이를 지켜 16:00~17:00 / 17:00~18:00으로 민다 — 막아 세우면 사용자가 종료부터 고치고
 * 다시 시작을 고쳐야 해서 두 번 일한다.
 *
 * 시작을 **당기는** 것은 뒤집히지 않으므로 종료를 건드리지 않는다 (일정이 길어질 뿐이다).
 *
 * 이미 자정을 넘는 구간은 같은 날 기준의 앞뒤 비교가 통하지 않으므로, 길이가 정확히 0이 되는
 * 경우가 아니면 그대로 둔다 — 밤 일정을 손볼 때 멋대로 낮으로 옮겨지지 않게.
 */
export function adjustRangeStart(
  start: TimeStr,
  end: TimeStr,
  newStart: TimeStr,
): { startTime: TimeStr; endTime: TimeStr } {
  const keep = { startTime: newStart, endTime: end }
  const flipped = !crossesMidnight(start, end) && parseTime(newStart) > parseTime(end)

  if (rangeLength(newStart, end) !== 0 && !flipped) return keep
  return { startTime: newStart, endTime: formatTime(parseTime(newStart) + rangeLength(start, end)) }
}

/** `adjustRangeStart`의 반대편 — 종료를 시작보다 앞으로 당기면 시작을 함께 당긴다. */
export function adjustRangeEnd(
  start: TimeStr,
  end: TimeStr,
  newEnd: TimeStr,
): { startTime: TimeStr; endTime: TimeStr } {
  const keep = { startTime: start, endTime: newEnd }
  const flipped = !crossesMidnight(start, end) && parseTime(newEnd) < parseTime(start)

  if (rangeLength(start, newEnd) !== 0 && !flipped) return keep
  return { startTime: formatTime(parseTime(newEnd) - rangeLength(start, end)), endTime: newEnd }
}

function parseDate(date: DateStr): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(date)
  if (!m) throw new Error(`날짜 형식이 아닙니다: ${date}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function formatDate(utc: Date): DateStr {
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
    utc.getUTCDate(),
  ).padStart(2, '0')}`
}

/**
 * 날짜 산술은 전부 UTC로 한다.
 * 로컬 Date로 하면 서머타임 전환일에 하루가 23/25시간이 되어 날짜가 어긋난다.
 * (한국은 서머타임이 없지만 이 함수가 그걸 전제할 이유는 없다)
 */
export function addDays(date: DateStr, days: number): DateStr {
  const { y, m, d } = parseDate(date)
  return formatDate(new Date(Date.UTC(y, m - 1, d + days)))
}

const WEEKDAY_BY_INDEX: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function weekdayOf(date: DateStr): Weekday {
  const { y, m, d } = parseDate(date)
  return WEEKDAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!
}
