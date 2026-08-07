import type { TimeStr } from '@shared/types'
import './TimeField.css'

/**
 * 시각 입력 — 시/분 드롭다운 두 개.
 *
 * `<input type="time">`을 쓰지 않는 이유: **Chromium의 네이티브 피커가 `step`을 무시하고
 * 분을 00, 01, 02… 로 나열한다.** `step={600}`을 줘도 스피너만 10분씩 움직일 뿐,
 * 드롭다운에서는 여전히 1분 단위를 고를 수 있어 "19:07" 같은 값이 들어온다.
 * 직접 그리면 고를 수 있는 값 자체가 격자로 제한된다.
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

  const minutes = Array.from({ length: Math.ceil(60 / stepMinutes) }, (_, i) =>
    String(i * stepMinutes).padStart(2, '0'),
  )
  /*
   * 예전에 저장된 값이나 구글에서 온 값은 격자 밖일 수 있다 (19:07).
   * 그럴 때 목록에 없는 값을 고르면 select가 빈칸으로 보이므로, 지금 값을 그대로 끼워 넣는다.
   * 사용자가 한 번 고르면 격자 값으로 바뀌고 이 항목은 사라진다.
   */
  const offGrid = !minutes.includes(minute)
  const minuteOptions = offGrid ? [...minutes, minute].sort() : minutes

  return (
    <span className="timefield" title={title}>
      <select
        aria-label="시"
        value={hour}
        disabled={disabled}
        onChange={(e) => onChange(`${e.target.value}:${minute}`)}
      >
        {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="timefield-sep">:</span>
      <select
        aria-label="분"
        value={minute}
        disabled={disabled}
        onChange={(e) => onChange(`${hour}:${e.target.value}`)}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </span>
  )
}
