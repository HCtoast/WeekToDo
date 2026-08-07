import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  getLogicalDate,
  getSmallWidgetRange,
  getWeekRange,
  relativeDayLabel,
} from '@shared/scheduler/logical-date'
import { resolveAnchor } from '@shared/scheduler/anchor'
import { DEFAULT_SETTINGS } from '@shared/settings-schema'

describe('getLogicalDate', () => {
  // 계획을 세우다 새벽에 넘어가도 "오늘"이 유지되어야 한다.
  it('dayStartHour 이전이면 아직 어제다', () => {
    expect(getLogicalDate(new Date(2026, 7, 4, 3, 0), 6)).toBe('2026-08-03')
    expect(getLogicalDate(new Date(2026, 7, 4, 5, 59), 6)).toBe('2026-08-03')
  })

  it('dayStartHour부터 오늘이다', () => {
    expect(getLogicalDate(new Date(2026, 7, 4, 6, 0), 6)).toBe('2026-08-04')
    expect(getLogicalDate(new Date(2026, 7, 4, 23, 30), 6)).toBe('2026-08-04')
  })

  it('월 경계에서도 어제로 넘어간다', () => {
    expect(getLogicalDate(new Date(2026, 8, 1, 2, 0), 6)).toBe('2026-08-31')
  })

  it('dayStartHour=0이면 자정 기준이다', () => {
    expect(getLogicalDate(new Date(2026, 7, 4, 3, 0), 0)).toBe('2026-08-04')
  })
})

describe('getWeekRange', () => {
  const monday = '2026-08-03'

  it('요일 고정 모드는 가장 가까운 과거의 그 요일부터 시작한다', () => {
    expect(getWeekRange(monday, 'monday')[0]).toBe('2026-08-03')
    expect(getWeekRange('2026-08-06', 'monday')[0]).toBe('2026-08-03')
    expect(getWeekRange('2026-08-06', 'sunday')[0]).toBe('2026-08-02')
    expect(getWeekRange('2026-08-06', 'saturday')[0]).toBe('2026-08-01')
  })

  it('시작 요일 당일이면 그날부터다', () => {
    expect(getWeekRange('2026-08-08', 'saturday')[0]).toBe('2026-08-08')
  })

  it('롤링 모드는 매일 한 칸씩 밀린다', () => {
    expect(getWeekRange(monday, 'today')[0]).toBe('2026-08-03')
    expect(getWeekRange(monday, 'yesterday')[0]).toBe('2026-08-02')
    expect(getWeekRange('2026-08-04', 'yesterday')[0]).toBe('2026-08-03')
  })

  it('항상 7일 연속이다', () => {
    const week = getWeekRange('2026-08-30', 'yesterday')
    expect(week).toHaveLength(7)
    expect(week).toEqual([
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ])
  })
})

describe('getSmallWidgetRange', () => {
  // 작은 위젯은 오늘+내일 고정 — weekStartMode의 영향을 받지 않는다.
  it('weekStartMode와 무관하게 오늘과 내일이다', () => {
    expect(getSmallWidgetRange('2026-08-03')).toEqual(['2026-08-03', '2026-08-04'])
  })
})

describe('daysBetween', () => {
  it('앞뒤 방향을 부호로 구분한다', () => {
    expect(daysBetween('2026-08-05', '2026-08-06')).toBe(1)
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0)
    expect(daysBetween('2026-08-05', '2026-08-03')).toBe(-2)
  })

  it('달과 해를 넘어도 맞는다', () => {
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('relativeDayLabel', () => {
  it('가까운 날은 우리말 이름을 쓴다', () => {
    expect(relativeDayLabel('2026-08-05', '2026-08-04')).toBe('어제')
    expect(relativeDayLabel('2026-08-05', '2026-08-05')).toBe('오늘')
    expect(relativeDayLabel('2026-08-05', '2026-08-06')).toBe('내일')
    expect(relativeDayLabel('2026-08-05', '2026-08-07')).toBe('모레')
  })

  it('먼 날은 일수로 센다', () => {
    expect(relativeDayLabel('2026-08-05', '2026-08-12')).toBe('7일 뒤')
    expect(relativeDayLabel('2026-08-05', '2026-07-31')).toBe('5일 전')
  })

  /*
   * 이 조합이 핵심이다.
   *
   * 8월 6일 새벽 2시는 dayStartHour(6시) 전이라 논리적으로 아직 8월 5일이다.
   * 그때 사용자가 말하는 "내일"은 벽시계로 더한 8월 7일이 아니라 **8월 6일**이어야 한다.
   * 채팅 스냅샷이 이 라벨을 그대로 실어 보내므로, 모델은 날짜를 더할 필요가 없다.
   */
  it('새벽에는 벽시계 날짜가 아니라 논리적 날짜를 기준으로 센다', () => {
    const dawn = new Date(2026, 7, 6, 2, 0)
    const today = getLogicalDate(dawn, 6)
    expect(today).toBe('2026-08-05')

    expect(relativeDayLabel(today, '2026-08-06')).toBe('내일')
    expect(relativeDayLabel(today, '2026-08-05')).toBe('오늘')
    // 벽시계로 더했다면 8월 7일이 "내일"이 됐을 것이다.
    expect(relativeDayLabel(today, '2026-08-07')).toBe('모레')
  })

  it('아침 7시에는 벽시계와 논리적 날짜가 같다', () => {
    const today = getLogicalDate(new Date(2026, 7, 6, 7, 0), 6)
    expect(today).toBe('2026-08-06')
    expect(relativeDayLabel(today, '2026-08-07')).toBe('내일')
  })
})

describe('resolveAnchor', () => {
  const weekdayTimes = { ...DEFAULT_SETTINGS.weekdayAnchorTimes, mon: '19:00', tue: '20:00' }

  it('override 행이 없으면 요일 기본값을 쓴다', () => {
    expect(resolveAnchor('2026-08-03', null, weekdayTimes)).toBe('19:00')
    expect(resolveAnchor('2026-08-04', null, weekdayTimes)).toBe('20:00')
  })

  it('override 행이 있으면 그 값이 이긴다', () => {
    expect(resolveAnchor('2026-08-03', { anchor_time: '21:30' }, weekdayTimes)).toBe('21:30')
  })

  it('앵커가 없는 날은 존재하지 않는다', () => {
    for (const date of ['2026-08-03', '2026-08-08', '2026-08-09']) {
      expect(resolveAnchor(date, undefined, DEFAULT_SETTINGS.weekdayAnchorTimes)).toMatch(
        /^\d{2}:\d{2}$/,
      )
    }
  })
})
