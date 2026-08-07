import type { DateStr, TimeStr } from '@shared/types'
import type { Weekday } from '@shared/settings-schema'
import { weekdayOf } from '@shared/scheduler/time'

/**
 * 그날의 앵커 시각. **항상 값이 나온다** — "앵커 없는 날"은 존재하지 않는다.
 *
 * 우선순위: anchors 행(manual 또는 autostart) > 요일 기본값.
 * 앞의 둘은 모두 DB 행으로 표현되므로 해석은 2단계로 끝난다.
 */
export function resolveAnchor(
  date: DateStr,
  override: { anchor_time: TimeStr } | null | undefined,
  weekdayAnchorTimes: Record<Weekday, TimeStr>,
): TimeStr {
  return override?.anchor_time ?? weekdayAnchorTimes[weekdayOf(date)]
}
