import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { HistoryDay } from '@shared/ipc-contract'
import type { CategoryRow } from '@shared/types'
import { weekdayOf } from '@shared/scheduler'
import './HistoryPanel.css'

const WEEKDAY_KO: Record<string, string> = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
  sun: '일',
}

/**
 * 완료 시각은 ISO(UTC) 문자열이므로 잘라 쓰면 안 된다.
 * 한국이면 9시간 어긋나 저녁에 한 일이 아침에 한 것처럼 보인다.
 */
function localTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * "지난번에 뭐 했는지" 훑어보는 화면.
 *
 * 기본은 날짜별 개수만 보여주고 펼쳐야 상세가 나온다 — 모든 완료 항목을 펼쳐두면
 * 사소한 것까지 섞여 정작 찾으려던 게 묻힌다.
 */
export default function HistoryPanel({
  categories,
  onClose,
}: {
  categories: CategoryRow[]
  onClose: () => void
}) {
  const [days, setDays] = useState<HistoryDay[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.loadHistory().then(setDays)
  }, [])

  const toggle = (date: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })

  const colorOf = (id: string | null): string =>
    categories.find((c) => c.id === id)?.base_color ?? 'var(--text-dim)'

  return (
    <div className="history">
      <header>
        <h2>완료 기록</h2>
        <button className="chrome-btn" onClick={onClose} title="닫기">
          <X size={15} strokeWidth={1.75} />
        </button>
      </header>

      <div className="history-body">
        {days === null ? (
          <p className="empty">불러오는 중…</p>
        ) : days.length === 0 ? (
          <p className="empty">
            아직 완료한 TODO가 없습니다.
            <br />
            히스토리에서 빼둔 카테고리의 항목은 여기 나오지 않습니다.
          </p>
        ) : (
          <ul className="history-days">
            {days.map((day) => (
              <li key={day.date}>
                <button className="day-row" onClick={() => toggle(day.date)}>
                  <span className="caret">
                    {expanded.has(day.date) ? (
                      <ChevronDown size={13} strokeWidth={2} />
                    ) : (
                      <ChevronRight size={13} strokeWidth={2} />
                    )}
                  </span>
                  <span className="day-label">
                    {day.date.slice(5)} ({WEEKDAY_KO[weekdayOf(day.date)]})
                  </span>
                  <span className="count">{day.items.length}건</span>
                </button>

                {expanded.has(day.date) && (
                  <ul className="items">
                    {day.items.map((item) => (
                      <li key={item.id}>
                        <i className="dot" style={{ background: colorOf(item.categoryId) }} />
                        <span className="item-title">{item.title}</span>
                        <span className="item-time">{localTime(item.completedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
