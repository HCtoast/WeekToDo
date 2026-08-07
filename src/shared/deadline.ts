import { DEADLINE_URGENT_MINUTES, DEADLINE_WARN_MINUTES } from '@shared/constants'
import type { Timestamp } from '@shared/types'

/**
 * 마감 계산. DB도 화면도 모르는 순수 함수.
 *
 * 입력 방식은 두 가지지만 카운트다운은 항상 `deadline_computed` 하나만 본다.
 * 원본 의도(`type` / `relativeDays`)는 나중에 수정할 때 "생성일 기준 N일"이라는 뜻을
 * 유지하려고 함께 남긴다.
 */

export type DeadlineType = 'absolute' | 'relative'

export interface DeadlineSpec {
  type: DeadlineType | null
  /** type='absolute'일 때의 ISO 시각 */
  absolute?: string | null
  /** type='relative'일 때의 "생성 후 N일" */
  relativeDays?: number | null
}

export interface ResolvedDeadline {
  deadline_type: DeadlineType | null
  deadline_absolute: Timestamp | null
  deadline_relative_days: number | null
  deadline_computed: Timestamp | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** `relative`는 생성 시각 + N일로 정규화한다 (기획서의 "생성 후 N일"을 그대로 따른다). */
export function resolveDeadline(spec: DeadlineSpec, createdAt: Timestamp): ResolvedDeadline {
  if (spec.type === 'absolute' && spec.absolute) {
    return {
      deadline_type: 'absolute',
      deadline_absolute: spec.absolute,
      deadline_relative_days: null,
      deadline_computed: spec.absolute,
    }
  }

  if (spec.type === 'relative' && typeof spec.relativeDays === 'number' && spec.relativeDays > 0) {
    const base = new Date(createdAt).getTime()
    return {
      deadline_type: 'relative',
      deadline_absolute: null,
      deadline_relative_days: spec.relativeDays,
      deadline_computed: new Date(base + spec.relativeDays * MS_PER_DAY).toISOString(),
    }
  }

  // 마감 없음 — 원본 의도까지 함께 지운다.
  return {
    deadline_type: null,
    deadline_absolute: null,
    deadline_relative_days: null,
    deadline_computed: null,
  }
}

export type DeadlineLevel = 'normal' | 'warn' | 'urgent' | 'overdue'

export interface Countdown {
  level: DeadlineLevel
  /** 남은 분. 지났으면 음수 */
  minutesLeft: number
  /** 기획서 형식 — '02D : 05H : 30M' */
  full: string
  /** 좁은 목록용 — '2일 5시간' / '30분' / '지남' */
  compact: string
}

function pad(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0')
}

/**
 * 카운트다운은 저장하지 않고 렌더링 시점마다 계산한다.
 * 임계값은 `shared/constants.ts`에 모아두어 나중에 설정으로 빼기 쉽게 했다.
 */
export function formatCountdown(deadline: Timestamp | null, now: Date): Countdown | null {
  if (!deadline) return null

  const minutesLeft = Math.floor((new Date(deadline).getTime() - now.getTime()) / 60_000)
  const abs = Math.abs(minutesLeft)
  const days = Math.floor(abs / (24 * 60))
  const hours = Math.floor((abs % (24 * 60)) / 60)
  const minutes = abs % 60

  const level: DeadlineLevel =
    minutesLeft < 0
      ? 'overdue'
      : minutesLeft < DEADLINE_URGENT_MINUTES
        ? 'urgent'
        : minutesLeft < DEADLINE_WARN_MINUTES
          ? 'warn'
          : 'normal'

  const compact =
    minutesLeft < 0
      ? '지남'
      : days > 0
        ? `${days}일 ${hours}시간`
        : hours > 0
          ? `${hours}시간 ${minutes}분`
          : `${minutes}분`

  return {
    level,
    minutesLeft,
    full: `${pad(days)}D : ${pad(hours)}H : ${pad(minutes)}M`,
    compact,
  }
}
