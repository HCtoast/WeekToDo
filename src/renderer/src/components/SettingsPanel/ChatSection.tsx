import { useCallback, useEffect, useState } from 'react'
import type { LlmStatus } from '@shared/ipc-contract'
import type { AppSettings } from '@shared/settings-schema'
import { LLM_MODELS, LLM_MODEL_LABEL, type LlmModel } from '@shared/constants'

/**
 * 자연어 명령(LLM) 설정.
 *
 * API 키는 입력만 하고 다시 읽어오지 않는다 — 메인이 암호화해 들고 있고 렌더러로는
 * "있는지"와 꼬리 4자만 내려온다. 화면에 되비추면 그 순간 평문으로 노출된다.
 */
export default function ChatSection({
  settings,
  onSet,
}: {
  settings: AppSettings
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}) {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setStatus(await window.api.llmStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!status) return null

  return (
    <>
      <h3>명령 입력</h3>

      {!status.hasApiKey || editing ? (
        <div className="client-form">
          <p className="note">
            console.anthropic.com에서 만든 API 키를 넣어주세요. 암호화해서 이 PC에만 저장되며 화면에
            다시 표시하지 않습니다. 요금은 사용자의 Anthropic 계정으로 청구됩니다.
          </p>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="client-form-actions">
            {status.hasApiKey && (
              <button
                className="mini"
                onClick={() => {
                  setEditing(false)
                  setKey('')
                }}
              >
                취소
              </button>
            )}
            <button
              className="mini active"
              disabled={!key.trim()}
              onClick={() =>
                void run(async () => {
                  await window.api.llmSetKey(key)
                  setKey('')
                  setEditing(false)
                })
              }
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <div className="row-main">
            <span className="row-label">
              키 저장됨{status.apiKeyHint ? ` · …${status.apiKeyHint}` : ''}
            </span>
            <div className="row-control">
              <button className="mini" onClick={() => setEditing(true)}>
                변경
              </button>
              <button
                className="mini danger"
                onClick={() => void run(() => window.api.llmSetKey(null))}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="google-error">{error}</p>}

      <div className="row">
        <div className="row-main">
          <span className="row-label">모델</span>
          <div className="row-control">
            <select
              value={settings.llmModel}
              onChange={(e) => onSet('llmModel', e.target.value as LlmModel)}
            >
              {LLM_MODELS.map((m) => (
                <option key={m} value={m}>
                  {LLM_MODEL_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint">
          미배치 TODO 왼쪽의 ✨ 버튼으로 엽니다. 한 줄을 치면 되묻지 않고 바로 반영되며, 답변은
          따로 뜨지 않습니다. 일정을 만들고 고칠 수 있지만 <strong>지우지는 못합니다</strong> —
          삭제는 그리드에서 우클릭해 직접 하세요.
        </p>
      </div>
    </>
  )
}
