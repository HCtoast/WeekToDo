import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  WEEKDAYS,
  type AppSettings,
  type BackgroundEffect,
  type MoveUnitMinutes,
  type WeekStartMode,
  type Weekday,
} from '@shared/settings-schema'
import { ANCHOR_STEP_MINUTES, MOVE_UNIT_CHOICES } from '@shared/constants'
import { ESCAPE_ATTR } from '@renderer/hooks/useClickThroughEscape'
import TimeField from '@renderer/components/TimeField/TimeField'
import GoogleSection from '@renderer/components/SettingsPanel/GoogleSection'
import ChatSection from '@renderer/components/SettingsPanel/ChatSection'
import './SettingsPanel.css'

const WEEKDAY_KO: Record<Weekday, string> = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
  sun: '일',
}

const WEEK_START_LABEL: Record<WeekStartMode, string> = {
  yesterday: '어제부터 (롤링)',
  today: '오늘부터 (롤링)',
  monday: '월요일 고정',
  sunday: '일요일 고정',
  saturday: '토요일 고정',
}

export default function SettingsPanel({
  settings,
  onSet,
  onClose,
}: {
  settings: AppSettings
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  onClose: () => void
}) {
  const [launchAtLogin, setLaunchAtLogin] = useState(false)

  // 시작 시 자동 실행은 DB가 아니라 OS가 들고 있는 값이라 별도로 읽는다.
  useEffect(() => {
    void window.api.isLaunchAtLogin().then(setLaunchAtLogin)
  }, [])

  return (
    // 클릭 통과 중에도 설정창은 만질 수 있어야 한다 (여기서 통과를 끄기 때문).
    <div className="settings" {...{ [ESCAPE_ATTR]: '' }}>
      <header>
        <h2>설정</h2>
        <button className="chrome-btn" onClick={onClose} title="닫기">
          <X size={15} strokeWidth={1.75} />
        </button>
      </header>

      <div className="settings-body">
        <Row label="하루 시작" hint="이 시각에 날짜가 바뀐다. 기본 6시라 새벽 3시는 아직 어제.">
          <input
            type="number"
            min={0}
            max={23}
            value={settings.dayStartHour}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 0 && v <= 23) onSet('dayStartHour', v)
            }}
          />
          <span className="unit">시</span>
        </Row>

        <Row label="주 시작" hint="큰 위젯(7일)에만 적용된다. 작은 위젯은 항상 오늘+내일.">
          <select
            value={settings.weekStartMode}
            onChange={(e) => onSet('weekStartMode', e.target.value as WeekStartMode)}
          >
            {(Object.keys(WEEK_START_LABEL) as WeekStartMode[]).map((m) => (
              <option key={m} value={m}>
                {WEEK_START_LABEL[m]}
              </option>
            ))}
          </select>
        </Row>

        <Row label="이동 단위" hint="드래그로 옮기거나 길이를 바꿀 때 붙는 격자.">
          <select
            value={settings.moveUnitMinutes}
            onChange={(e) => onSet('moveUnitMinutes', Number(e.target.value) as MoveUnitMinutes)}
          >
            {MOVE_UNIT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
        </Row>

        <h3>모양</h3>

        <Row
          label="화면 배율"
          hint="글자와 아이콘이 함께 커집니다. 창 크기는 그대로라 너무 키우면 7일 뷰가 좁아집니다."
        >
          <input
            type="range"
            min={100}
            max={150}
            step={5}
            value={settings.uiScale}
            onChange={(e) => onSet('uiScale', Number(e.target.value))}
          />
          <span className="unit">{settings.uiScale}%</span>
        </Row>

        <Row
          label="뒷배경"
          hint={
            settings.backgroundEffect === 'acrylic'
              ? '창 뒤를 흐리게 (Windows 유리 효과).'
              : '흐림 없이 바탕화면이 그대로 비칩니다.'
          }
        >
          <select
            value={settings.backgroundEffect}
            onChange={(e) => onSet('backgroundEffect', e.target.value as BackgroundEffect)}
          >
            <option value="acrylic">유리 (흐림)</option>
            <option value="clear">그대로 비침</option>
          </select>
        </Row>

        <Row label="배경 진하기" hint="배경 위에 얹는 어두운 정도. 낮출수록 뒤가 잘 보입니다.">
          <input
            type="range"
            min={0}
            max={100}
            value={settings.widgetOpacity}
            onChange={(e) => onSet('widgetOpacity', Number(e.target.value))}
          />
          <span className="unit">{settings.widgetOpacity}%</span>
        </Row>

        <Row label="클릭 통과" hint="고정 모드에서 마우스를 통과시켜 완전히 배경처럼 만든다.">
          <input
            type="checkbox"
            checked={settings.clickThrough}
            onChange={(e) => onSet('clickThrough', e.target.checked)}
          />
        </Row>

        <h3>앵커</h3>
        <p className="note">
          큐가 시작되는 기준 시각. 그날 직접 지정하지 않으면 아래 요일 기본값을 쓴다.
        </p>

        <div className="weekday-anchors">
          {WEEKDAYS.map((d) => (
            <label key={d}>
              <span>{WEEKDAY_KO[d]}</span>
              {/* 30분 단위로만 (00/30) */}
              <TimeField
                value={settings.weekdayAnchorTimes[d]}
                stepMinutes={ANCHOR_STEP_MINUTES}
                onChange={(time) =>
                  onSet('weekdayAnchorTimes', { ...settings.weekdayAnchorTimes, [d]: time })
                }
              />
            </label>
          ))}
        </div>

        <Row
          label="부팅 시 앵커 자동 설정"
          hint="시작앱으로 자동 실행된 시각을 30분 단위로 올려 그날 앵커로 기록한다 (06:40 → 07:00). 그날 앵커가 이미 있으면 건드리지 않는다."
        >
          <input
            type="checkbox"
            checked={settings.autoAnchorOnLaunch}
            onChange={(e) => onSet('autoAnchorOnLaunch', e.target.checked)}
          />
        </Row>

        <Row
          label="시작 시 자동 실행"
          hint="Windows 시작프로그램에 등록합니다. 처음 실행할 때 자동으로 켜져 있습니다."
        >
          <input
            type="checkbox"
            checked={launchAtLogin}
            onChange={(e) => {
              setLaunchAtLogin(e.target.checked)
              void window.api.setLaunchAtLogin(e.target.checked)
            }}
          />
        </Row>

        <ChatSection settings={settings} onSet={onSet} />
        <GoogleSection settings={settings} onSet={onSet} />
      </div>
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="row">
      <div className="row-main">
        <span className="row-label">{label}</span>
        <div className="row-control">{children}</div>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}
