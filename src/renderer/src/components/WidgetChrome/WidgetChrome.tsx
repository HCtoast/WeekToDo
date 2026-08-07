import { Lock, LockOpen, Maximize2, Minimize2, Settings, CheckCheck, X } from 'lucide-react'
import type { AppSettings } from '@shared/settings-schema'
import { ESCAPE_ATTR } from '@renderer/hooks/useClickThroughEscape'
import './WidgetChrome.css'

/** 위젯 안의 아이콘은 전부 이 크기·굵기로 통일한다 */
export const ICON_SIZE = 15
export const ICON_STROKE = 1.75

/**
 * 타이틀바 — 이동/고정 모드, 크기 모드, 완료 기록, 설정, 숨기기.
 *
 * 프레임리스 창은 `-webkit-app-region: drag` 영역으로만 움직인다.
 * 그래서 고정 모드에서는 그 영역을 아예 없애 창이 안 잡히게 한다 (메인의 setMovable과 짝).
 */
export default function WidgetChrome({
  settings,
  onSet,
  onOpenSettings,
  onOpenHistory,
}: {
  settings: AppSettings
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  onOpenSettings: () => void
  onOpenHistory: () => void
}) {
  const moving = settings.widgetMode === 'move'
  const large = settings.widgetSizeMode === 'large'
  const icon = { size: ICON_SIZE, strokeWidth: ICON_STROKE }

  return (
    <header className={`titlebar ${moving ? 'is-movable' : ''}`}>
      <span className="title">주간 타임블록</span>

      <div className="actions">
        <button
          className={`chrome-btn ${moving ? 'active' : ''}`}
          title={moving ? '이동 모드 — 끌어서 옮기고 크기 조절 가능' : '고정 모드 — 잠김'}
          onClick={() => onSet('widgetMode', moving ? 'fixed' : 'move')}
        >
          {moving ? <LockOpen {...icon} /> : <Lock {...icon} />}
        </button>

        <button
          className="chrome-btn"
          title={large ? '접기 — 오늘+내일' : '펼치기 — 7일'}
          onClick={() => onSet('widgetSizeMode', large ? 'small' : 'large')}
        >
          {large ? <Minimize2 {...icon} /> : <Maximize2 {...icon} />}
        </button>

        <button className="chrome-btn" title="완료 기록" onClick={onOpenHistory}>
          <CheckCheck {...icon} />
        </button>

        {/* 클릭 통과 중에도 이 버튼만은 살아있어야 통과를 되돌릴 수 있다. */}
        <button
          className="chrome-btn"
          title="설정"
          onClick={onOpenSettings}
          {...{ [ESCAPE_ATTR]: '' }}
        >
          <Settings {...icon} />
        </button>

        <button
          className="chrome-btn"
          title="숨기기 — 트레이 아이콘으로 다시 띄웁니다"
          onClick={() => window.close()}
        >
          <X {...icon} />
        </button>
      </div>
    </header>
  )
}

