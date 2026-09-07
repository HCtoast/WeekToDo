import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  WEEKDAYS,
  type AppSettings,
  type BackgroundEffect,
  type MoveUnitMinutes,
  type WeekStartMode,
  type Weekday,
  type WindowLayer,
} from '@shared/settings-schema'
import { ANCHOR_STEP_MINUTES, MOVE_UNIT_CHOICES } from '@shared/constants'
import { ESCAPE_ATTR } from '@renderer/hooks/useClickThroughEscape'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
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
          <Input
            type="number"
            min={0}
            max={23}
            className="h-7 w-16 px-2 text-body-sm"
            value={settings.dayStartHour}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 0 && v <= 23) onSet('dayStartHour', v)
            }}
          />
          <span className="unit">시</span>
        </Row>

        <Row label="주 시작" hint="큰 위젯(7일)에만 적용된다. 작은 위젯은 항상 오늘+내일.">
          <ChoiceSelect
            value={settings.weekStartMode}
            onChange={(v) => onSet('weekStartMode', v)}
            options={(Object.keys(WEEK_START_LABEL) as WeekStartMode[]).map((m) => ({
              value: m,
              label: WEEK_START_LABEL[m],
            }))}
          />
        </Row>

        <Row label="이동 단위" hint="드래그로 옮기거나 길이를 바꿀 때 붙는 격자.">
          {/* Radix Select는 값이 문자열이라 오갈 때 변환한다 */}
          <ChoiceSelect
            value={String(settings.moveUnitMinutes)}
            onChange={(v) => onSet('moveUnitMinutes', Number(v) as MoveUnitMinutes)}
            options={MOVE_UNIT_CHOICES.map((m) => ({ value: String(m), label: `${m}분` }))}
          />
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
          <ChoiceSelect
            value={settings.backgroundEffect}
            onChange={(v) => onSet('backgroundEffect', v as BackgroundEffect)}
            options={[
              { value: 'acrylic', label: '유리 (흐림)' },
              { value: 'clear', label: '그대로 비침' },
            ]}
          />
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

        <Row
          label="창 층"
          hint={
            settings.windowLayer === 'top'
              ? '전체화면 앱 위에서도 유지됩니다.'
              : '바탕화면(움직이는 배경화면 포함) 위, 지금 쓰는 앱 아래. 다른 앱을 가리지 않습니다.'
          }
        >
          <ChoiceSelect
            value={settings.windowLayer}
            onChange={(v) => onSet('windowLayer', v as WindowLayer)}
            options={[
              { value: 'desktop', label: '배경 위 (앱에 가려짐)' },
              { value: 'top', label: '항상 위' },
            ]}
          />
        </Row>

        <Row label="클릭 통과" hint="고정 모드에서 마우스를 통과시켜 완전히 배경처럼 만든다.">
          <Checkbox
            checked={settings.clickThrough}
            onCheckedChange={(v) => onSet('clickThrough', v === true)}
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
          <Checkbox
            checked={settings.autoAnchorOnLaunch}
            onCheckedChange={(v) => onSet('autoAnchorOnLaunch', v === true)}
          />
        </Row>

        <Row
          label="시작 시 자동 실행"
          hint="Windows 시작프로그램에 등록합니다. 처음 실행할 때 자동으로 켜져 있습니다."
        >
          <Checkbox
            checked={launchAtLogin}
            onCheckedChange={(v) => {
              const next = v === true
              setLaunchAtLogin(next)
              void window.api.setLaunchAtLogin(next)
            }}
          />
        </Row>

        <ChatSection settings={settings} onSet={onSet} />
        <GoogleSection settings={settings} onSet={onSet} />
      </div>
    </div>
  )
}

/**
 * 설정에서 쓰는 좁은 셀렉트.
 *
 * 원본 `ui/select`는 h-10(40px) · text-body로 일반 웹앱 기준이다. 이 위젯의 설정은
 * 한 화면에 20줄 가까이 들어가는 조밀한 목록이라 그대로 쓰면 두 배로 길어진다.
 * 높이·글자만 줄이고 나머지(포커스·키보드·포털)는 그대로 쓴다.
 */
function ChoiceSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-7 w-auto gap-1.5 px-2.5 text-body-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="py-1.5 text-body-sm">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
