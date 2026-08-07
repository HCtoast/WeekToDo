import { describe, expect, it } from 'vitest'
import { formatCountdown, resolveDeadline } from '@shared/deadline'

const CREATED = '2026-08-04T10:00:00.000Z'

describe('resolveDeadline', () => {
  it('absolute는 그대로 computed가 된다', () => {
    expect(resolveDeadline({ type: 'absolute', absolute: '2026-08-09T15:00:00.000Z' }, CREATED))
      .toEqual({
        deadline_type: 'absolute',
        deadline_absolute: '2026-08-09T15:00:00.000Z',
        deadline_relative_days: null,
        deadline_computed: '2026-08-09T15:00:00.000Z',
      })
  })

  // 카운트다운이 computed 하나만 보면 되도록 생성 시점에 정규화한다.
  it('relative는 생성 시각 + N일로 정규화한다', () => {
    const r = resolveDeadline({ type: 'relative', relativeDays: 3 }, CREATED)
    expect(r.deadline_computed).toBe('2026-08-07T10:00:00.000Z')
    // 원본 의도는 남겨야 나중에 수정할 때 "생성일 기준 N일"을 유지할 수 있다.
    expect(r.deadline_relative_days).toBe(3)
    expect(r.deadline_type).toBe('relative')
  })

  it('마감 없음이면 원본 의도까지 전부 지운다', () => {
    expect(resolveDeadline({ type: null }, CREATED)).toEqual({
      deadline_type: null,
      deadline_absolute: null,
      deadline_relative_days: null,
      deadline_computed: null,
    })
  })

  it('값이 빠졌거나 이상하면 마감 없음으로 떨어진다', () => {
    expect(resolveDeadline({ type: 'absolute', absolute: null }, CREATED).deadline_computed).toBeNull()
    expect(resolveDeadline({ type: 'relative', relativeDays: 0 }, CREATED).deadline_computed).toBeNull()
    expect(resolveDeadline({ type: 'relative', relativeDays: -1 }, CREATED).deadline_computed).toBeNull()
  })
})

describe('formatCountdown', () => {
  const now = new Date('2026-08-04T10:00:00.000Z')
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000).toISOString()

  it('마감이 없으면 null', () => {
    expect(formatCountdown(null, now)).toBeNull()
  })

  it('기획서 형식으로 남은 시간을 만든다', () => {
    expect(formatCountdown(inMinutes(2 * 24 * 60 + 5 * 60 + 30), now)?.full).toBe('02D : 05H : 30M')
    expect(formatCountdown(inMinutes(30), now)?.full).toBe('00D : 00H : 30M')
  })

  // 24h 이상 기본 / 6~24h 주황 / 6h 미만 빨강 / 지남
  it('임계값에 따라 단계가 바뀐다', () => {
    expect(formatCountdown(inMinutes(48 * 60), now)?.level).toBe('normal')
    expect(formatCountdown(inMinutes(24 * 60), now)?.level).toBe('normal')
    expect(formatCountdown(inMinutes(24 * 60 - 1), now)?.level).toBe('warn')
    expect(formatCountdown(inMinutes(6 * 60), now)?.level).toBe('warn')
    expect(formatCountdown(inMinutes(6 * 60 - 1), now)?.level).toBe('urgent')
    expect(formatCountdown(inMinutes(0), now)?.level).toBe('urgent')
    expect(formatCountdown(inMinutes(-1), now)?.level).toBe('overdue')
  })

  it('좁은 목록용 짧은 표기', () => {
    expect(formatCountdown(inMinutes(2 * 24 * 60 + 5 * 60), now)?.compact).toBe('2일 5시간')
    expect(formatCountdown(inMinutes(90), now)?.compact).toBe('1시간 30분')
    expect(formatCountdown(inMinutes(30), now)?.compact).toBe('30분')
    expect(formatCountdown(inMinutes(-120), now)?.compact).toBe('지남')
  })

  it('지난 시간도 절댓값으로 표기한다', () => {
    expect(formatCountdown(inMinutes(-(25 * 60)), now)?.full).toBe('01D : 01H : 00M')
  })
})
