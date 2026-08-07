import { describe, expect, it } from 'vitest'
import {
  addDays,
  adjustRangeEnd,
  adjustRangeStart,
  formatTime,
  fromDayOffset,
  parseTime,
  snapTimeToUnit,
  snapToUnit,
  snapUpToUnit,
  toDayOffset,
  weekdayOf,
} from '@shared/scheduler/time'

describe('toDayOffset / fromDayOffset', () => {
  // dayStartHour=6 기준. 하루는 06:00에 시작해 다음날 06:00에 끝난다.
  it('하루 시작이 0이다', () => {
    expect(toDayOffset('06:00', 6)).toBe(0)
    expect(toDayOffset('07:00', 6)).toBe(60)
    expect(toDayOffset('19:00', 6)).toBe(13 * 60)
  })

  it('새벽 시각은 하루의 끝쪽에 놓인다', () => {
    expect(toDayOffset('02:00', 6)).toBe(20 * 60)
    expect(toDayOffset('05:59', 6)).toBe(1439)
  })

  it('왕복해도 값이 유지된다', () => {
    for (const t of ['06:00', '13:45', '23:59', '00:30', '05:00']) {
      expect(fromDayOffset(toDayOffset(t, 6), 6)).toBe(t)
    }
  })

  it('dayStartHour=0이면 자정 기준과 같다', () => {
    expect(toDayOffset('02:00', 0)).toBe(120)
  })
})

describe('snapUpToUnit', () => {
  it('30분 단위로 올린다', () => {
    expect(snapUpToUnit('06:40', 30)).toBe('07:00')
    expect(snapUpToUnit('06:01', 30)).toBe('06:30')
    expect(snapUpToUnit('19:31', 30)).toBe('20:00')
  })

  it('이미 단위에 맞으면 그대로 둔다', () => {
    expect(snapUpToUnit('07:00', 30)).toBe('07:00')
    expect(snapUpToUnit('07:30', 30)).toBe('07:30')
  })

  it('자정을 넘으면 감긴다', () => {
    expect(snapUpToUnit('23:50', 30)).toBe('00:00')
  })
})

describe('snapToUnit', () => {
  it('가장 가까운 단위로 붙인다', () => {
    expect(snapToUnit(44, 30)).toBe(30)
    expect(snapToUnit(46, 30)).toBe(60)
    expect(snapToUnit(60, 30)).toBe(60)
  })

  it('15분/60분 단위도 처리한다', () => {
    expect(snapToUnit(70, 15)).toBe(75)
    expect(snapToUnit(70, 60)).toBe(60)
  })
})

describe('snapTimeToUnit', () => {
  it('15분 단위로 붙인다 (00/15/30/45)', () => {
    expect(snapTimeToUnit('19:07', 15)).toBe('19:00')
    expect(snapTimeToUnit('19:08', 15)).toBe('19:15')
    expect(snapTimeToUnit('19:38', 15)).toBe('19:45')
    expect(snapTimeToUnit('19:53', 15)).toBe('20:00')
  })

  it('이미 단위에 맞으면 그대로 둔다', () => {
    for (const t of ['19:00', '19:15', '19:30', '19:45']) {
      expect(snapTimeToUnit(t, 15)).toBe(t)
    }
  })

  it('자정을 넘으면 감긴다', () => {
    expect(snapTimeToUnit('23:55', 15)).toBe('00:00')
  })
})

describe('parseTime / formatTime', () => {
  it('형식이 아니면 던진다', () => {
    expect(() => parseTime('9:00')).toThrow()
    expect(() => parseTime('24:00')).toThrow()
    expect(() => parseTime('12:60')).toThrow()
  })

  it('1440분을 넘으면 감아서 표기한다', () => {
    expect(formatTime(1500)).toBe('01:00')
  })
})

describe('addDays', () => {
  it('월/연 경계를 넘는다', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('윤년을 처리한다', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('adjustRangeStart', () => {
  // 뒤집힐 때만 민다 — 막아 세우면 사용자가 종료부터 고치고 다시 시작을 고쳐야 한다.
  it('시작이 종료와 같아지면 길이를 지켜 민다', () => {
    expect(adjustRangeStart('15:00', '16:00', '16:00')).toEqual({
      startTime: '16:00',
      endTime: '17:00',
    })
  })

  it('시작이 종료를 넘어가도 길이를 지켜 민다', () => {
    expect(adjustRangeStart('15:00', '16:00', '17:00')).toEqual({
      startTime: '17:00',
      endTime: '18:00',
    })
  })

  // 여기가 "무조건 유지"와 갈리는 지점이다.
  it('시작을 당길 때는 종료를 건드리지 않는다 (길어질 뿐)', () => {
    expect(adjustRangeStart('15:00', '16:30', '14:00')).toEqual({
      startTime: '14:00',
      endTime: '16:30',
    })
  })

  it('종료 안쪽으로 늦추는 것도 종료를 건드리지 않는다 (짧아질 뿐)', () => {
    expect(adjustRangeStart('15:00', '16:30', '16:00')).toEqual({
      startTime: '16:00',
      endTime: '16:30',
    })
  })

  it('밀 때 자정을 넘으면 감긴다', () => {
    expect(adjustRangeStart('22:30', '23:30', '23:30')).toEqual({
      startTime: '23:30',
      endTime: '00:30',
    })
  })

  // 자정을 넘는 구간은 같은 날 앞뒤 비교가 통하지 않는다. 멋대로 낮으로 옮기지 않는다.
  it('이미 자정을 넘는 구간은 그대로 둔다', () => {
    expect(adjustRangeStart('23:00', '00:30', '22:00')).toEqual({
      startTime: '22:00',
      endTime: '00:30',
    })
  })

  it('자정을 넘는 구간이라도 길이가 0이 되면 민다', () => {
    expect(adjustRangeStart('23:00', '00:30', '00:30')).toEqual({
      startTime: '00:30',
      endTime: '02:00',
    })
  })
})

describe('adjustRangeEnd', () => {
  it('종료가 시작보다 앞서면 시작을 함께 당긴다', () => {
    expect(adjustRangeEnd('15:00', '16:00', '14:00')).toEqual({
      startTime: '13:00',
      endTime: '14:00',
    })
  })

  it('종료가 시작과 같아져도 당긴다', () => {
    expect(adjustRangeEnd('15:00', '16:00', '15:00')).toEqual({
      startTime: '14:00',
      endTime: '15:00',
    })
  })

  it('뒤로 늘리는 것은 시작을 건드리지 않는다', () => {
    expect(adjustRangeEnd('15:00', '16:00', '18:00')).toEqual({
      startTime: '15:00',
      endTime: '18:00',
    })
  })

  it('자정을 넘는 구간은 그대로 둔다 (23:00~00:00 → 23:00~01:00)', () => {
    expect(adjustRangeEnd('23:00', '00:00', '01:00')).toEqual({
      startTime: '23:00',
      endTime: '01:00',
    })
  })
})

describe('weekdayOf', () => {
  it('요일을 돌려준다', () => {
    expect(weekdayOf('2026-08-03')).toBe('mon')
    expect(weekdayOf('2026-08-08')).toBe('sat')
    expect(weekdayOf('2026-08-09')).toBe('sun')
  })
})
