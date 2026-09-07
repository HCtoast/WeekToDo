import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LIGHTNESS,
  CATEGORY_NEUTRAL,
  CATEGORY_PALETTE,
  CATEGORY_SATURATION,
  categoryColorAt,
  hueAt,
} from '@shared/category-palette'
import { BLOCK_MIN_LIGHTNESS, parseHsl } from '@shared/color'

/**
 * 팔레트(.ts)와 마이그레이션(.sql)은 서로를 import할 수 없다.
 * 그래서 한쪽만 고쳐도 아무도 모르게 어긋난다 — 실제로 003을 넣을 때 그렇게 됐고
 * (SQL은 S 34~44%/L 66%, .ts는 S 48~76%/L 62%), 주석만 "이제 .ts가 기준"이라고 말하고 있었다.
 * 이 파일이 그 상태를 깨뜨린다.
 */

const MIGRATION = readFileSync(
  join(__dirname, '../main/db/migrations/003_category_palette.sql'),
  'utf8',
)

/** 003이 각 카테고리에 넣는 색 (`SET base_color = 'hsl(...)'`) */
function migrationColors(): string[] {
  return [...MIGRATION.matchAll(/SET base_color = '([^']+)'/g)].map((m) => m[1])
}

describe('카테고리 팔레트', () => {
  it('밝기가 BLOCK_MIN_LIGHTNESS보다 위다 — 저장값 = 보이는 값', () => {
    // 아래로 내려가면 ensureReadableBackground()가 렌더링 때마다 조용히 밝혀버린다.
    expect(CATEGORY_LIGHTNESS).toBeGreaterThan(BLOCK_MIN_LIGHTNESS)
  })

  it('모든 색이 같은 밝기다 — 하나만 튀면 안 된다', () => {
    for (const c of [...CATEGORY_PALETTE, CATEGORY_NEUTRAL]) {
      expect(parseHsl(c.hsl).l, c.key).toBe(CATEGORY_LIGHTNESS)
    }
  })

  it('배경형 도구라 채도가 낮다', () => {
    for (const c of CATEGORY_PALETTE) {
      expect(parseHsl(c.hsl).s, c.key).toBeLessThanOrEqual(44)
    }
    // 무채색은 따로 — 구분이 아니라 "분류 없음"을 뜻한다.
    expect(parseHsl(CATEGORY_NEUTRAL.hsl).s).toBeLessThan(15)
  })

  it('키가 겹치지 않는다', () => {
    const keys = CATEGORY_PALETTE.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('003 마이그레이션과의 정합', () => {
  it('마이그레이션이 넣는 색이 전부 팔레트에 있다', () => {
    const known = new Set([...CATEGORY_PALETTE, CATEGORY_NEUTRAL].map((c) => c.hsl))
    const colors = migrationColors()

    // 정규식이 아무것도 못 잡았는데 통과하는 일이 없도록.
    expect(colors.length).toBeGreaterThan(0)
    for (const color of colors) expect(known, `${color}가 팔레트에 없다`).toContain(color)
  })
})

describe('categoryColorAt', () => {
  it('팔레트 범위 안에서는 표를 그대로 준다', () => {
    expect(categoryColorAt(0)).toBe(CATEGORY_PALETTE[0].hsl)
    expect(categoryColorAt(CATEGORY_PALETTE.length - 1)).toBe(
      CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1].hsl,
    )
  })

  it('넘어가면 같은 규격으로 만들어 준다', () => {
    const hsl = parseHsl(categoryColorAt(CATEGORY_PALETTE.length))
    expect(hsl.l).toBe(CATEGORY_LIGHTNESS)
    expect(hsl.s).toBe(CATEGORY_SATURATION)
  })

  it('황금각이라 늘려도 hue가 겹치지 않는다', () => {
    const hues = Array.from({ length: 24 }, (_, i) => hueAt(i))
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i] - hues[j])
        expect(Math.min(d, 360 - d), `${i}번과 ${j}번`).toBeGreaterThan(5)
      }
    }
  })
})
