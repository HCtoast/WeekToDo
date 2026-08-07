import { describe, expect, it } from 'vitest'
import { ANCHOR_SNAP_MINUTES, DEFAULT_DAY_START_HOUR } from '@shared/constants'

/** Phase 0: vitest + @shared 별칭이 실제로 동작하는지 확인하는 스모크 테스트. */
describe('테스트 환경', () => {
  it('@shared 별칭으로 모듈을 불러온다', () => {
    expect(ANCHOR_SNAP_MINUTES).toBe(30)
    expect(DEFAULT_DAY_START_HOUR).toBe(6)
  })
})
