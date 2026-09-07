import { describe, expect, it } from 'vitest'
import {
  GOOGLE_LIGHTNESS,
  GOOGLE_MAX_SATURATION,
  googleBlockColor,
  hexToHsl,
} from '@shared/google-colors'
import { parseHsl } from '@shared/color'
import { CATEGORY_PALETTE } from '@shared/category-palette'

describe('hexToHsl', () => {
  it('구글이 주는 hex를 HSL로 옮긴다', () => {
    expect(hexToHsl('#5484ed')).toEqual({ h: 221, s: 81, l: 63 }) // Blueberry
    expect(hexToHsl('#fbd75b')).toEqual({ h: 47, s: 95, l: 67 }) // Banana
  })

  it('무채색은 채도 0', () => {
    expect(hexToHsl('#e1e1e1')?.s).toBe(0) // Graphite
  })

  it('형식이 아니면 null', () => {
    expect(hexToHsl('rgb(1,2,3)')).toBeNull()
    expect(hexToHsl('#abc')).toBeNull()
  })
})

describe('googleBlockColor — hue는 살리고 채도는 누른다', () => {
  it('일정별 색(colorId)이 있으면 그 hue를 쓴다', () => {
    // Blueberry(파랑)와 Banana(노랑)는 hue가 확실히 갈려야 한다 — 회사/개인 구분의 근거다.
    const blue = parseHsl(googleBlockColor('9', null))
    const yellow = parseHsl(googleBlockColor('5', null))
    expect(Math.abs(blue.h - yellow.h)).toBeGreaterThan(100)
  })

  it('colorId가 캘린더 색을 이긴다', () => {
    const withEventColor = parseHsl(googleBlockColor('5', '#5484ed'))
    expect(withEventColor.h).toBe(47) // Banana의 hue
  })

  it('colorId가 없으면 캘린더 색을 쓴다', () => {
    expect(parseHsl(googleBlockColor(null, '#5484ed')).h).toBe(221)
  })

  it('둘 다 없으면 무채색', () => {
    expect(parseHsl(googleBlockColor(null, null)).s).toBeLessThan(10)
  })

  it('모르는 colorId는 캘린더 색으로 흘러간다', () => {
    expect(parseHsl(googleBlockColor('99', '#5484ed')).h).toBe(221)
  })

  it('채도는 항상 상한 아래 — 카테고리와 겹치면 안 된다', () => {
    const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
    for (const id of ids) {
      expect(parseHsl(googleBlockColor(id, null)).s, id).toBeLessThanOrEqual(
        GOOGLE_MAX_SATURATION,
      )
    }
  })

  it('어떤 카테고리보다도 흐리다 — "색이 있으면 내 것"이 유지된다', () => {
    const lowestCategory = Math.min(...CATEGORY_PALETTE.map((c) => parseHsl(c.hsl).s))
    expect(GOOGLE_MAX_SATURATION).toBeLessThan(lowestCategory)
  })

  it('밝기는 하나로 통일된다', () => {
    for (const id of ['1', '5', '9', null]) {
      expect(parseHsl(googleBlockColor(id, null)).l).toBe(GOOGLE_LIGHTNESS)
    }
  })
})
