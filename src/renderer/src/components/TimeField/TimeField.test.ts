import { describe, expect, it } from 'vitest'
import { nearestOption, windowAround } from '@renderer/components/TimeField/TimeField'

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))

describe('windowAround — 시 목록을 현재 값 주변만 남긴다', () => {
  it('가운데 값을 중심으로 앞뒤 size개를 준다', () => {
    expect(windowAround(HOURS, '20', 3)).toEqual(['17', '18', '19', '20', '21', '22', '23'])
  })

  it('현재 값이 늘 가운데다', () => {
    for (const v of HOURS) {
      const out = windowAround(HOURS, v, 3)
      expect(out).toHaveLength(7)
      expect(out[3]).toBe(v)
    }
  })

  it('자정을 넘어 감긴다 — 23시 앵커에게 00시가 멀면 안 된다', () => {
    expect(windowAround(HOURS, '23', 3)).toEqual(['20', '21', '22', '23', '00', '01', '02'])
    expect(windowAround(HOURS, '00', 2)).toEqual(['22', '23', '00', '01', '02'])
  })

  it('창이 목록보다 넓으면 전부 준다', () => {
    expect(windowAround(HOURS, '12', 12)).toEqual(HOURS)
    expect(windowAround(['00', '30'], '00', 3)).toEqual(['00', '30'])
  })

  it('목록에 없는 값이면 손대지 않는다 — 구글에서 온 격자 밖 값', () => {
    expect(windowAround(HOURS, '07:30', 3)).toEqual(HOURS)
  })

  it('중복을 만들지 않는다', () => {
    const out = windowAround(HOURS, '01', 3)
    expect(new Set(out).size).toBe(out.length)
  })
})

describe('nearestOption — 친 숫자를 격자로 끌어당긴다', () => {
  const MIN10 = ['00', '10', '20', '30', '40', '50']

  it('격자에 있는 값은 그대로', () => {
    expect(nearestOption(HOURS, '13')).toBe('13')
    expect(nearestOption(MIN10, '30')).toBe('30')
  })

  it('한 자리는 앞을 0으로 채운다', () => {
    expect(nearestOption(HOURS, '7')).toBe('07')
    expect(nearestOption(HOURS, '0')).toBe('00')
  })

  it('격자 밖이면 가장 가까운 값으로', () => {
    expect(nearestOption(MIN10, '17')).toBe('20')
    expect(nearestOption(MIN10, '12')).toBe('10')
    expect(nearestOption(['00', '30'], '20')).toBe('30')
  })

  it('같은 거리면 앞쪽', () => {
    expect(nearestOption(['00', '30'], '15')).toBe('00')
  })

  it('범위를 넘으면 끝값으로 붙는다 — 25시는 없다', () => {
    expect(nearestOption(HOURS, '25')).toBe('23')
  })

  it('숫자가 아니거나 목록이 비면 null', () => {
    expect(nearestOption(HOURS, '')).toBeNull()
    expect(nearestOption([], '10')).toBeNull()
  })
})
