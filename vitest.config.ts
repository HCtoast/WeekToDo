import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 테스트 대상은 src/shared — Electron도 DB도 모르는 순수 로직만 여기 둔다.
 * Phase 2의 스케줄 계산 엔진이 이 설정의 주 사용처다.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    include: ['src/shared/**/*.test.ts'],
    environment: 'node',
  },
})
