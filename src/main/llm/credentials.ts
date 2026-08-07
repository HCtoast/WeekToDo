import { safeStorage } from 'electron'
import Store from 'electron-store'

/**
 * LLM API 키 저장소.
 *
 * 구글 자격증명과 같은 원칙이다 — `settings` 테이블에 두지 않는다.
 * 거기 있는 값은 `getAllSettings()`로 통째로 렌더러에 내려가므로 키가 화면 쪽으로 샌다.
 * 별도 파일에 `safeStorage`로 암호화해 두고 메인에서만 읽는다. 렌더러에는
 * "키가 있는지"와 마지막 네 자리만 내려간다 (되비추면 그 순간 평문 노출).
 */
interface StoredLlmAuth {
  /** safeStorage로 암호화한 뒤 base64 */
  apiKeyEnc?: string
  /** 어떤 키를 넣었는지 알아보기 위한 꼬리 4자 — 키 복원에는 쓸 수 없다 */
  apiKeyHint?: string
}

const store = new Store<StoredLlmAuth>({ name: 'llm-auth' })

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '이 시스템에서 암호화 저장을 쓸 수 없어 API 키를 저장하지 않았습니다. 평문으로는 저장하지 않습니다.',
    )
  }
  return safeStorage.encryptString(value).toString('base64')
}

export function getApiKey(): string | null {
  const enc = store.get('apiKeyEnc')
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    // 다른 사용자 계정으로 복사됐거나 OS 키가 바뀌면 복호화가 실패한다. 다시 입력받아야 한다.
    return null
  }
}

export function setApiKey(key: string | null): void {
  if (key === null) {
    store.delete('apiKeyEnc')
    store.delete('apiKeyHint')
    return
  }

  const trimmed = key.trim()
  if (!trimmed) throw new Error('API 키가 비어 있습니다.')
  store.set('apiKeyEnc', encrypt(trimmed))
  store.set('apiKeyHint', trimmed.slice(-4))
}

export function getApiKeyHint(): string | null {
  return store.get('apiKeyHint') ?? null
}

/** 자격증명 파일 경로 — 문제 생겼을 때 사용자에게 알려주기 위함 */
export function getLlmCredentialsPath(): string {
  return store.path
}
