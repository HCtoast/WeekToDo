import { GOOGLE_SYNC_INTERVAL_MS } from '@shared/constants'
import type { GoogleStatus } from '@shared/ipc-contract'
import { getAccount, getClientCredentials, getCredentialsPath, getRefreshToken } from '@main/google/credentials'
import { syncGoogleEvents } from '@main/google/sync'
import {
  createGoogleEvent,
  deleteGoogleEvent,
  patchGoogleEvent,
  type GoogleEventDraft,
  type GoogleEventPatch,
} from '@main/google/write'

/**
 * 동기화 상태와 주기 실행.
 *
 * 실패를 던져 올리지 않고 상태로 들고 있는다 — 네트워크가 끊겼다고 위젯이 멈추면 안 되고,
 * 캐시가 있으므로 오프라인에서도 화면은 그대로 동작해야 한다.
 */
let lastSyncedAt: string | null = null
let lastError: string | null = null
let timer: NodeJS.Timeout | null = null
let running = false

export function getGoogleStatus(): GoogleStatus {
  return {
    hasClientCredentials: getClientCredentials() !== null,
    connected: getRefreshToken() !== null && getClientCredentials() !== null,
    account: getAccount(),
    credentialsPath: getCredentialsPath(),
    lastSyncedAt,
    lastError,
  }
}

/** 동기화를 한 번 돌린다. 이미 돌고 있으면 겹쳐 돌리지 않는다. */
export async function runSync(): Promise<{ events: number }> {
  // 캘린더를 하나도 안 골랐으면 sync 자체는 "0건"으로 조용히 끝난다.
  // 사용자가 직접 누른 경우엔 왜 아무 일도 안 일어났는지 알려줘야 하므로 여기서 먼저 막는다.
  if (getClientCredentials() === null) {
    throw new Error('구글 클라이언트 ID와 시크릿을 먼저 입력하세요.')
  }
  if (getRefreshToken() === null) {
    throw new Error('구글 계정이 연결되어 있지 않습니다.')
  }

  if (running) return { events: 0 }
  running = true
  try {
    const result = await syncGoogleEvents()
    lastSyncedAt = new Date().toISOString()
    lastError = null
    return { events: result.events }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    running = false
  }
}

/**
 * 구글 이벤트를 고치고 캐시를 맞춘다.
 *
 * 쓰기 뒤에 곧바로 동기화를 돌리는 이유: 구글이 실제로 저장한 값이 우리가 보낸 것과
 * 다를 수 있고(시간대 보정, 반복 인스턴스 분리 등), 캐시를 손으로 고쳐두면
 * 5분 뒤 정기 동기화 때 조용히 뒤집힌다.
 *
 * API가 실패하면 캐시는 그대로이므로 화면이 다시 읽는 순간 원래 자리로 돌아간다 —
 * 별도의 되돌리기 코드가 필요 없다.
 */
export async function updateGoogleEvent(id: string, patch: GoogleEventPatch): Promise<void> {
  await patchGoogleEvent(id, patch)
  await runSync()
}

/** 새 일정을 구글에 만들고 캐시를 맞춘다. 위와 같은 이유로 캐시를 직접 채우지 않는다. */
export async function addGoogleEvent(draft: GoogleEventDraft): Promise<void> {
  await createGoogleEvent(draft)
  await runSync()
}

/** 구글에서 지우고 캐시를 맞춘다. 되돌릴 수 없으므로 호출부에서 확인을 받는다. */
export async function removeGoogleEvent(id: string): Promise<void> {
  await deleteGoogleEvent(id)
  await runSync()
}

/** 실패해도 조용히 넘어가는 백그라운드용 */
async function syncQuietly(onDone: () => void): Promise<void> {
  try {
    await runSync()
    onDone()
  } catch {
    // lastError에 남았으므로 설정 화면에서 확인할 수 있다.
  }
}

export function startGoogleSync(onSynced: () => void): void {
  const tick = (): void => {
    if (getRefreshToken() === null) return
    void syncQuietly(onSynced)
  }

  tick()
  timer = setInterval(tick, GOOGLE_SYNC_INTERVAL_MS)
  timer.unref?.()
}

export function stopGoogleSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}
