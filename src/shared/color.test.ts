import { describe, expect, it } from 'vitest'
import {
  accentColor,
  alternateLightness,
  BLOCK_ACCENT_FALLBACK,
  BLOCK_ACCENT_LIGHTNESS,
  BLOCK_ACCENT_MIN_SATURATION,
  BLOCK_MIN_LIGHTNESS,
  ensureReadableBackground,
  formatHsl,
  parseHsl,
  shiftLightness,
} from '@shared/color'

describe('parseHsl', () => {
  it('공백 구분과 콤마 구분을 모두 읽는다', () => {
    expect(parseHsl('hsl(212 70% 55%)')).toEqual({ h: 212, s: 70, l: 55 })
    expect(parseHsl('hsl(212, 70%, 55%)')).toEqual({ h: 212, s: 70, l: 55 })
  })

  it('형식이 아니면 던진다', () => {
    expect(() => parseHsl('#ff0000')).toThrow()
    expect(() => parseHsl('rgb(1,2,3)')).toThrow()
  })

  it('왕복해도 값이 유지된다', () => {
    expect(formatHsl(parseHsl('hsl(212, 70%, 55%)'))).toBe('hsl(212 70% 55%)')
  })
})

describe('shiftLightness', () => {
  it('0~100 범위를 넘지 않는다', () => {
    expect(shiftLightness({ h: 0, s: 50, l: 97 }, 8).l).toBe(100)
    expect(shiftLightness({ h: 0, s: 50, l: 3 }, -8).l).toBe(0)
  })
})

describe('accentColor', () => {
  it('hue는 그대로 두고 어둡고 진하게 바꾼다', () => {
    const accent = parseHsl(accentColor('hsl(212 70% 55%)'))
    expect(accent.h).toBe(212)
    expect(accent.l).toBe(BLOCK_ACCENT_LIGHTNESS)
    expect(accent.s).toBe(70)
  })

  it('채도가 낮은 색은 끌어올려 띠가 회색으로 죽지 않게 한다', () => {
    expect(parseHsl(accentColor('hsl(30 10% 60%)')).s).toBe(BLOCK_ACCENT_MIN_SATURATION)
  })

  // 배경은 검은 글자를 받치느라 밝은 쪽으로 몰린다. 띠는 반대로 가야 hue가 드러난다.
  it('언제나 블록 배경보다 어둡다', () => {
    for (const c of ['hsl(212 70% 55%)', 'hsl(0 80% 90%)', 'hsl(140 20% 30%)']) {
      expect(parseHsl(accentColor(c)).l).toBeLessThan(BLOCK_MIN_LIGHTNESS)
    }
  })

  it('카테고리가 없으면 중립색을 쓴다', () => {
    expect(accentColor(null)).toBe(BLOCK_ACCENT_FALLBACK)
    expect(accentColor(undefined)).toBe(BLOCK_ACCENT_FALLBACK)
  })
})

describe('ensureReadableBackground', () => {
  // 글자를 검정으로 통일했으므로 배경이 어두우면 안 읽힌다.
  it('어두운 색은 최소 밝기까지 끌어올린다', () => {
    expect(ensureReadableBackground('hsl(220 10% 45%)')).toBe('hsl(220 10% 58%)')
    expect(ensureReadableBackground('hsl(356 68% 40%)')).toBe('hsl(356 68% 58%)')
  })

  it('색조와 채도는 건드리지 않는다', () => {
    const out = parseHsl(ensureReadableBackground('hsl(275 55% 30%)'))
    expect(out.h).toBe(275)
    expect(out.s).toBe(55)
  })

  it('이미 밝으면 그대로 둔다', () => {
    expect(ensureReadableBackground('hsl(275 55% 72%)')).toBe('hsl(275 55% 72%)')
  })
})

describe('alternateLightness', () => {
  const base = 'hsl(212 70% 55%)'

  it('연속 구간의 짝수 번째는 기본색 그대로', () => {
    expect(alternateLightness(base, 0)).toBe('hsl(212 70% 55%)')
    expect(alternateLightness(base, 2)).toBe('hsl(212 70% 55%)')
  })

  it('홀수 번째는 밝게 (게임1 / 게임2 구분)', () => {
    expect(alternateLightness(base, 1)).toBe('hsl(212 70% 63%)')
    expect(alternateLightness(base, 3)).toBe('hsl(212 70% 63%)')
  })

  // 그냥 더하기만 하면 밝은 색에서 100%로 붙어버려 두 블록이 같은 색이 된다.
  it('이미 밝은 색은 반대로 어둡게 내려 구분을 유지한다', () => {
    const light = 'hsl(212 70% 95%)'
    expect(alternateLightness(light, 1)).toBe('hsl(212 70% 87%)')
    expect(alternateLightness(light, 1)).not.toBe(alternateLightness(light, 0))
  })
})
