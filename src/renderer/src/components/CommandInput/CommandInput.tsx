import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import './CommandInput.css'

/**
 * 자연어 명령 입력 창의 내용. **별도 창(`?view=command`)에서만 렌더된다.**
 *
 * **대화가 아니다** (기획서: input-only, 되묻기 없음). 한 줄을 치면 그대로 실행되고,
 * 피드백은 위젯이 실제로 바뀌는 것으로 준다 — 답변 말풍선도 결과 로그도 없다.
 * 예외는 아무 일도 일어나지 않았을 때뿐이다. 그때는 왜인지 알려주지 않으면
 * 사용자가 "먹통"으로 오해한다.
 */
export default function CommandInput() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  /** 아무것도 실행되지 않았을 때만 보여주는 한 줄 */
  const [notice, setNotice] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.api.llmStatus().then((s) => setHasKey(s.hasApiKey))
  }, [])

  const run = async (): Promise<void> => {
    const command = text.trim()
    if (!command || busy) return

    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.llmRun(command)
      const failed = result.actions.filter((a) => !a.ok)

      if (result.actions.length > 0 && failed.length === 0) {
        // 성공 — 바뀐 위젯이 곧 피드백이다. 창을 닫는다.
        void window.api.closeCommandWindow()
        return
      }
      // 아무것도 못 했거나 일부 실패했을 때만 이유를 남기고 창을 띄워둔다.
      setNotice(failed[0]?.summary ?? result.text ?? '아무 일도 일어나지 않았습니다.')
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      // IPC를 건너온 오류는 `Error invoking remote method '...': Error: ...`로 감싸여 온다.
      setNotice(
        raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, ''),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    // 이 창은 App(위젯)이 아니라 별도 진입점이라 루트의 .hct가 닿지 않는다. 여기서 직접 세운다.
    <div className="cmdwin hct">
      <div className="cmdwin-row">
        <Sparkles size={16} strokeWidth={2} className="cmdwin-icon" />
        <input
          ref={inputRef}
          className="cmdwin-input"
          value={text}
          disabled={busy}
          placeholder="내일 저녁 8시에 캡스톤 미팅 1시간"
          onChange={(e) => {
            setText(e.target.value)
            setNotice(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return void window.api.closeCommandWindow()
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void run()
          }}
        />
      </div>

      {!hasKey ? (
        <p className="cmdwin-note is-warn">설정 &gt; 명령 입력에서 API 키를 먼저 넣어주세요.</p>
      ) : notice ? (
        <p className="cmdwin-note is-warn">{notice}</p>
      ) : (
        <p className="cmdwin-note">{busy ? '실행 중…' : 'Enter 실행 · Esc 닫기'}</p>
      )}
    </div>
  )
}
