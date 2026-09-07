import { useCallback, useEffect, useState } from 'react'
import type { GoogleCalendarInfo, GoogleStatus } from '@shared/ipc-contract'
import type { AppSettings } from '@shared/settings-schema'
import { GOOGLE_REMINDER_CHOICES } from '@shared/constants'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'

/**
 * "첫 번째 캘린더"(= 지정 안 함)를 나타내는 센티널.
 * Radix Select는 빈 문자열을 항목 값으로 허용하지 않는다 — 그걸 placeholder 표시에 쓰기 때문.
 * DB에는 그대로 null로 저장한다.
 */
const FIRST_CALENDAR = '__first__'

/**
 * 구글 캘린더 연결.
 *
 * 클라이언트 시크릿은 입력만 하고 다시 읽어오지 않는다 — 메인이 암호화해 들고 있고
 * 렌더러로는 "있는지 여부"만 내려온다. 화면에 되비추면 그 순간 평문으로 노출된다.
 */
export default function GoogleSection({
  settings,
  onSet,
}: {
  settings: AppSettings
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}) {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingClient, setEditingClient] = useState(false)

  const refresh = useCallback(async () => {
    const s = await window.api.googleStatus()
    setStatus(s)
    if (s.connected) {
      try {
        setCalendars(await window.api.googleListCalendars())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } else {
      setCalendars([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!status) return <p className="note">불러오는 중…</p>

  return (
    <>
      <h3>구글 캘린더</h3>

      {!status.hasClientCredentials || editingClient ? (
        <ClientForm
          onCancel={status.hasClientCredentials ? () => setEditingClient(false) : undefined}
          onSubmit={(creds) =>
            void run('저장', async () => {
              await window.api.googleSetClient(creds)
              setEditingClient(false)
            })
          }
        />
      ) : (
        <div className="row">
          <div className="row-main">
            <span className="row-label">
              {status.connected ? `연결됨${status.account ? ` · ${status.account}` : ''}` : '연결 안 됨'}
            </span>
            <div className="row-control">
              {status.connected ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run('동기화', () => window.api.googleSyncNow())}
                  >
                    {busy === '동기화' ? '동기화 중…' : '지금 동기화'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run('해제', () => window.api.googleDisconnect())}
                  >
                    연결 해제
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run('연결', () => window.api.googleConnect())}
                >
                  {busy === '연결' ? '브라우저에서 로그인 중…' : '구글 계정 연결'}
                </Button>
              )}
            </div>
          </div>
          <p className="hint">
            클라이언트 자격증명은 저장되어 있습니다.{' '}
            <button className="linklike" onClick={() => setEditingClient(true)}>
              변경
            </button>
          </p>
        </div>
      )}

      {error && <p className="google-error">{error}</p>}

      {status.connected && calendars.length > 0 && (
        <>
          <p className="note">동기화할 캘린더를 고르세요. 고르지 않으면 아무것도 가져오지 않습니다.</p>
          <ul className="calendars">
            {calendars.map((c) => (
              <li key={c.id}>
                <label>
                  <Checkbox
                    checked={settings.googleCalendarIds.includes(c.id)}
                    onCheckedChange={(v) => {
                      const next =
                        v === true
                          ? [...settings.googleCalendarIds, c.id]
                          : settings.googleCalendarIds.filter((id) => id !== c.id)
                      onSet('googleCalendarIds', next)
                    }}
                  />
                  <i className="cal-dot" style={{ background: c.backgroundColor ?? '#888' }} />
                  <span>{c.summary}</span>
                  {c.primary && <em>기본</em>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {status.connected && settings.googleCalendarIds.length > 0 && (
        <>
          <div className="row">
            <div className="row-main">
              <span className="row-label">새 일정을 만들 캘린더</span>
              <div className="row-control">
                {/* Radix Select는 빈 문자열을 값으로 쓸 수 없어 센티널을 둔다 */}
                <Select
                  value={settings.googleWriteCalendarId ?? FIRST_CALENDAR}
                  onValueChange={(v) =>
                    onSet('googleWriteCalendarId', v === FIRST_CALENDAR ? null : v)
                  }
                >
                  <SelectTrigger className="h-7 w-auto gap-1.5 px-2.5 text-body-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FIRST_CALENDAR} className="py-1.5 text-body-sm">
                      첫 번째 캘린더
                    </SelectItem>
                    {calendars
                      .filter((c) => settings.googleCalendarIds.includes(c.id))
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id} className="py-1.5 text-body-sm">
                          {c.summary}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="hint">
              그리드 빈 칸을 우클릭해 &ldquo;구글에 일정 만들기&rdquo;로 만든 일정이 여기 저장됩니다.
            </p>
          </div>

          <div className="row">
            <div className="row-main">
              <span className="row-label">새 일정의 알림</span>
              <div className="row-control">
                <Select
                  value={String(settings.googleReminderMinutes)}
                  onValueChange={(v) =>
                    onSet('googleReminderMinutes', v === 'null' ? null : Number(v))
                  }
                >
                  <SelectTrigger className="h-7 w-auto gap-1.5 px-2.5 text-body-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOOGLE_REMINDER_CHOICES.map((m) => (
                      <SelectItem
                        key={String(m)}
                        value={String(m)}
                        className="py-1.5 text-body-sm"
                      >
                        {m === null ? '없음' : m === 0 ? '정시' : `${m}분 전`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="hint">
              이 앱에서 만든 일정에만 붙습니다. 캘린더의 기본 알림은 따르지 않으며,{' '}
              <strong>이메일 알림은 넣지 않습니다</strong> — 위젯에서 툭툭 만드는 일정이 전부 메일로
              오면 메일함이 잠깁니다.
            </p>
          </div>
        </>
      )}

      {status.lastError && <p className="google-error">마지막 동기화 실패: {status.lastError}</p>}
      {status.lastSyncedAt && (
        <p className="hint">마지막 동기화 {new Date(status.lastSyncedAt).toLocaleTimeString('ko-KR')}</p>
      )}
    </>
  )
}

function ClientForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (creds: { clientId: string; clientSecret: string }) => void
  onCancel?: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  return (
    <div className="client-form">
      <p className="note">
        Google Cloud Console에서 만든 <strong>데스크톱 앱</strong> OAuth 클라이언트의 ID와 시크릿을
        입력하세요. 암호화해서 이 PC에만 저장되며 화면에 다시 표시하지 않습니다.
      </p>
      <Input
        placeholder="클라이언트 ID"
        className="h-8 text-body-sm"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <Input
        type="password"
        placeholder="클라이언트 시크릿"
        className="h-8 text-body-sm"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
      />
      <div className="client-form-actions">
        {onCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button
          size="sm"
          disabled={!clientId.trim() || !clientSecret.trim()}
          onClick={() => onSubmit({ clientId, clientSecret })}
        >
          저장
        </Button>
      </div>
    </div>
  )
}
