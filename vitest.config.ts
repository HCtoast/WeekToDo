import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 테스트 대상은 src/shared — Electron도 DB도 모르는 순수 로직만 여기 둔다.
 * Phase 2의 스케줄 계산 엔진이 이 설정의 주 사용처다.
 *
 * src/renderer도 일부 포함한다. React를 띄우는 테스트는 여기 두지 않고,
 * lib/cn처럼 DOM 없이 문자열만 다루는 순수 유틸만 대상으로 한다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    include: ['src/shared/**/*.test.ts', 'src/renderer/**/*.test.ts'],
    environment: 'node',
  },
})
