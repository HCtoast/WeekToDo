import { useRef, useState } from 'react'
import type { TimeStr } from '@shared/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import './TimeField.css'

/**
 * 시각 입력 — 시/분 드롭다운 두 개.
 *
 * `<input type="time">`을 쓰지 않는 이유: **Chromium의 네이티브 피커가 `step`을 무시하고
 * 분을 00, 01, 02… 로 나열한다.** `step={600}`을 줘도 스피너만 10분씩 움직일 뿐,
 * 드롭다운에서는 여전히 1분 단위를 고를 수 있어 "19:07" 같은 값이 들어온다.
 * 직접 그리면 고를 수 있는 값 자체가 격자로 제한된다.
 *
 * 목록은 **체크 표시를 쓰지 않는다** (`showIndicator={false}`). 두 글자짜리 좁은 칸이라
 * 체크 자리가 숫자보다 넓어진다. 선택된 값은 색과 굵기로 드러낸다.
 */
export default function TimeField({
  value,
  stepMinutes,
  disabled,
  title,
  onChange,
}: {
  value: TimeStr
  /** 분 드롭다운의 간격. 10이면 00/10/…/50, 30이면 00/30 */
  stepMinutes: number
  disabled?: boolean
  title?: string
  onChange: (time: TimeStr) => void
}) {
  const [hour = '00', minute = '00'] = value.split(':')

  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
  const minutes = Array.from({ length: Math.ceil(60 / stepMinutes) }, (_, i) =>
    String(i * stepMinutes).padStart(2, '0'),
  )
  /*
   * 예전에 저장된 값이나 구글에서 온 값은 격자 밖일 수 있다 (19:07).
   * 그럴 때 목록에 없는 값을 고르면 빈칸으로 보이므로, 지금 값을 그대로 끼워 넣는다.
   * 사용자가 한 번 고르면 격자 값으로 바뀌고 이 항목은 사라진다.
   */
  const offGrid = !minutes.includes(minute)
  const minuteOptions = offGrid ? [...minutes, minute].sort() : minutes

  return (
    <span className="timefield" title={title}>
      <TimePart
        label="시"
        value={hour}
        options={hours}
        windowSize={HOUR_WINDOW}
        disabled={disabled}
        onChange={(h) => onChange(`${h}:${minute}`)}
      />
      <span className="timefield-sep">:</span>
      <TimePart
        label="분"
        value={minute}
        options={minuteOptions}
        disabled={disabled}
        onChange={(m) => onChange(`${hour}:${m}`)}
      />
    </span>
  )
}

/**
 * 시 목록을 처음에 몇 시간치만 열지 (현재 값 앞뒤로).
 * 7개면 한 화면에 다 들어와 스크롤 없이 고를 수 있다.
 */
const HOUR_WINDOW = 3

/** 한 자리만 치고 멈췄을 때 확정하기까지 기다리는 시간 */
const TYPE_COMMIT_MS = 600

/**
 * 친 숫자와 가장 가까운 선택지. 격자 밖 값을 격자로 끌어당긴다
 * (분이 10분 단위일 때 "17"을 치면 20). 같은 거리면 앞쪽을 고른다.
 */
export function nearestOption(options: string[], typed: string): string | null {
  // `Number('')`은 0이라 빈 입력이 00시로 확정돼 버린다. 먼저 걸러낸다.
  if (typed === '' || options.length === 0) return null
  const n = Number(typed)
  if (!Number.isFinite(n)) return null
  const exact = options.find((o) => o === typed.padStart(2, '0'))
  if (exact) return exact
  return options.reduce((best, o) =>
    Math.abs(Number(o) - n) < Math.abs(Number(best) - n) ? o : best,
  )
}

/**
 * `value`를 가운데 두고 앞뒤 `size`개만 남긴다. 24시간은 순환하므로 끝에서 감는다 —
 * 23시 앵커를 쓰는 사람에게 00·01시가 "멀리" 있으면 안 된다.
 */
export function windowAround(options: string[], value: string, size: number): string[] {
  const at = options.indexOf(value)
  if (at < 0) return options
  const n = options.length
  if (size * 2 + 1 >= n) return options
  return Array.from({ length: size * 2 + 1 }, (_, i) => options[(at - size + i + n) % n])
}

function TimePart({
  label,
  value,
  options,
  windowSize,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  /** 주면 처음엔 현재 값 앞뒤로만 보여주고, "전체"를 누르면 펼친다 */
  windowSize?: number
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  /** 직접 친 숫자를 모으는 버퍼. 두 자리가 차거나 잠시 멈추면 확정한다. */
  const typed = useRef<{ digits: string; timer?: ReturnType<typeof setTimeout> }>({ digits: '' })

  const windowed = windowSize !== undefined && !expanded
  const shown = windowed ? windowAround(options, value, windowSize) : options

  /**
   * 목록을 열지 않고 **숫자를 쳐서** 바꾼다.
   *
   * 드롭다운만으로는 17시에서 3시로 갈 때 여러 번 눌러야 한다.
   * 두 자리가 차면 바로 확정하고, 한 자리만 치고 멈추면 그 한 자리로 해석한다 ("7" → 07).
   */
  const commitTyped = (digits: string): void => {
    const next = nearestOption(options, digits)
    if (next !== null) onChange(next)
  }

  const onTypeDigit = (key: string): void => {
    const buf = typed.current
    clearTimeout(buf.timer)
    buf.digits = (buf.digits + key).slice(-2)

    // 두 자리가 차면 바로 확정, 한 자리면 잠깐 기다렸다가 확정한다.
    if (buf.digits.length === 2) {
      const d = buf.digits
      buf.digits = ''
      commitTyped(d)
      return
    }
    buf.timer = setTimeout(() => {
      const d = buf.digits
      buf.digits = ''
      commitTyped(d)
    }, TYPE_COMMIT_MS)
  }

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      // 닫힐 때마다 접어둔다 — 다음에 열 때 또 24개가 쏟아지면 줄인 의미가 없다.
      onOpenChange={(open) => !open && setExpanded(false)}
    >
      {/* 화살표(SelectIcon)는 CSS에서 숨긴다 — 시·분이 나란히 붙는 자리라 둘이면 숫자를 밀어낸다 */}
      <SelectTrigger
        aria-label={label}
        title="숫자를 치거나 ↑↓로 바꿀 수 있습니다"
        className="h-6 w-auto min-w-0 justify-center gap-0 px-1.5 text-body-sm"
        onKeyDown={(e) => {
          if (/^[0-9]$/.test(e.key)) {
            // Radix는 숫자를 타이핑 점프로 쓰며 목록을 연다. 여기서는 직접 값을 바꾸므로 막는다.
            e.preventDefault()
            e.stopPropagation()
            onTypeDigit(e.key)
            return
          }
          // ↑↓는 목록을 열지 않고 한 칸씩 옮긴다 — 30분 앞뒤 같은 잔손질이 대부분이다.
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            const at = options.indexOf(value)
            if (at < 0) return
            const step = e.key === 'ArrowDown' ? 1 : -1
            onChange(options[(at + step + options.length) % options.length])
          }
        }}
      >
        <SelectValue />
      </SelectTrigger>
      {/*
        높이를 묶어둔다. popper 기본값은 `--radix-select-content-available-height`라
        펼친 24시간 목록이 화면 끝까지 벽처럼 뻗는다. 선택된 값으로 스크롤은 Radix가 해준다.
        (좁힌 목록 7개 + "전체" 버튼이 스크롤 없이 들어가는 높이이기도 하다)
      */}
      <SelectContent
        className="max-h-72 w-auto min-w-0"
        /*
         * 숫자를 치면 곧바로 전체를 펼친다.
         *
         * Radix의 타이핑 점프는 **그려진 항목만** 훑는다. 창을 좁혀두면 멀리 있는 값은
         * 목록에도 없어서 쳐도 안 잡힌다 — 17시에서 13시로 갈 때 "전체"를 먼저 눌러야 했다.
         * 첫 타를 펼치는 데 쓰고, 이어지는 타부터 Radix가 점프시킨다.
         */
        onKeyDown={(e) => {
          if (windowed && /^[0-9]$/.test(e.key)) setExpanded(true)
        }}
      >
        {shown.map((o) => (
          <SelectItem
            key={o}
            value={o}
            showIndicator={false}
            className="justify-center px-3 py-1"
          >
            {o}
          </SelectItem>
        ))}
        {/*
          SelectItem이 아니라 평범한 버튼이다 — 고르는 값이 아니라 목록을 넓히는 동작이라
          누른다고 창이 닫히면 안 된다. mousedown을 막아 Radix가 바깥 클릭으로 보지 않게 한다.
        */}
        {windowed && (
          <button
            type="button"
            className="mt-1 w-full rounded-md px-3 py-1 text-caption text-fg-muted hover:bg-action-soft hover:text-fg"
            onMouseDown={(e) => {
              e.preventDefault()
              setExpanded(true)
            }}
          >
            전체
          </button>
        )}
      </SelectContent>
    </Select>
  )
}
