import { safeStorage } from 'electron'
import Store from 'electron-store'

/**
 * 구글 자격증명 저장소.
 *
 * settings 테이블에 두지 않는 이유: `getAllSettings()`는 통째로 렌더러에 내려가므로
 * 거기 넣는 순간 토큰이 화면 쪽으로 새어 나간다. 별도 파일에 두고 메인에서만 읽는다.
 *
 * 시크릿과 토큰은 `safeStorage`로 암호화해 저장한다 (평문 저장 금지).
 */
interface StoredCredentials {
  clientId?: string
  /** safeStorage로 암호화한 뒤 base64 */
  clientSecretEnc?: string
  refreshTokenEnc?: string
  /** 마지막으로 인증한 계정 — 화면에 "누구로 연결됐는지" 보여주기 위함 */
  account?: string
}

const store = new Store<StoredCredentials>({ name: 'google-auth' })

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '이 시스템에서 암호화 저장을 쓸 수 없어 구글 자격증명을 저장하지 않았습니다. ' +
        '평문으로는 저장하지 않습니다.',
    )
  }
}

function encrypt(value: string): string {
  assertEncryptionAvailable()
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string | undefined): string | null {
  if (!value) return null
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    // 다른 사용자 계정으로 복사됐거나 OS 키가 바뀌면 복호화가 실패한다.
    // 이 경우 재인증이 필요하므로 없는 것으로 취급한다.
    return null
  }
}

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

export function getClientCredentials(): ClientCredentials | null {
  const clientId = store.get('clientId')
  const clientSecret = decrypt(store.get('clientSecretEnc'))
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function setClientCredentials(creds: ClientCredentials | null): void {
  if (creds === null) {
    store.delete('clientId')
    store.delete('clientSecretEnc')
    return
  }
  store.set('clientId', creds.clientId.trim())
  store.set('clientSecretEnc', encrypt(creds.clientSecret.trim()))
}

export function getRefreshToken(): string | null {
  return decrypt(store.get('refreshTokenEnc'))
}

export function setRefreshToken(token: string | null, account?: string): void {
  if (token === null) {
    store.delete('refreshTokenEnc')
    store.delete('account')
    return
  }
  store.set('refreshTokenEnc', encrypt(token))
  if (account) store.set('account', account)
}

export function getAccount(): string | null {
  return store.get('account') ?? null
}

/** 자격증명 파일 경로 — 문제 생겼을 때 사용자에게 알려주기 위함 */
export function getCredentialsPath(): string {
  return store.path
}
