import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Anchor, CalendarDays, Check, Play, Plus } from 'lucide-react'
import type { DaySchedule, Mutation } from '@shared/ipc-contract'
import type { CategoryRow, DateStr } from '@shared/types'
import { ANCHOR_STEP_MINUTES, STACKED_TODO_OFFSET_PX } from '@shared/constants'
import {
  MINUTES_PER_DAY,
  fromDayOffset,
  layoutDay,
  snapToUnit,
  toDayOffset,
  weekdayOf,
  type PlacedBlock,
  type QueueItem,
} from '@shared/scheduler'
import { accentColor, alternateLightness, ensureReadableBackground } from '@shared/color'
import type { ContextMenuState } from '@renderer/components/ContextMenu/ContextMenu'
import TimeField from '@renderer/components/TimeField/TimeField'
import './WeekGrid.css'

/**
 * 1분당 픽셀. 30분짜리 블록이 27px이라 제목 한 줄이 잘리지 않고 들어간다.
 * 전체 배율은 설정의 `uiScale`(줌 배율)이 따로 담당한다.
 */
const PX_PER_MINUTE = 0.9
/**
 * 이 높이(px) 아래로는 제목과 시각을 위아래로 쌓지 않고 한 줄에 나란히 놓는다.
 *
 * 두 줄을 쌓으려면 제목 16px + 시각 14px + 안팎 여백 6px ≈ 36px가 필요한데,
 * 30분짜리 블록은 27px뿐이라 시각이 잘려 나간다.
 */
const STACKED_BLOCK_MIN_PX = 36
/** 백로그에서 끌어다 놓은 TODO의 기본 길이 */
const DEFAULT_SLOT_MINUTES = 60

/**
 * 종일 일정 칩 한 줄의 높이(px). 칩 17px + 아래 여백 2px.
 *
 * 종일 띠는 날짜 머리 **위**에 따로 있고, 칩은 자기 요일 열 위에 놓인다.
 * 열마다 있는 만큼만 높이를 주면 열끼리 아래 내용이 어긋나므로,
 * "가장 많은 날의 개수 × 한 줄"로 모든 열이 같은 높이를 쓴다.
 */
const ALL_DAY_ROW_PX = 19


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
 * 포인터 캡처는 실패할 수 있다 (이미 다른 요소가 캡처 중이거나, 합성 이벤트인 경우).
 * 그냥 호출하면 예외가 나면서 아래 리스너 등록까지 건너뛰어 드래그가 조용히 죽으므로 감싼다.
 * 캡처가 안 돼도 드래그 자체는 동작한다 — 포인터가 요소 밖으로 나갈 때만 아쉬워질 뿐.
 */
function capturePointer(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* 무시 */
  }
}

/**
 * 드래그 중에만 살아있는 미리보기 상태.
 * 확정되면 지우고 서버에서 다시 읽는다 — 밀림 결과는 파생 계산이라 화면에서 추측하면 어긋난다.
 */
type Draft =
  | { kind: 'reorder'; date: DateStr; orderedIds: string[] }
  | { kind: 'resize'; date: DateStr; id: string; durationMinutes: number }
  /**
   * 절대 시각 블록(TODO 슬롯 · 홀드한 구글 이벤트)의 이동.
   * 둘 다 밀림 계산 밖이라 옮기는 방식이 같고, 확정할 때 보내는 mutation만 다르다.
   */
  | {
      kind: 'moveFixed'
      target: 'todo' | 'google'
      id: string
      date: DateStr
      startOffset: number
      durationMinutes: number
      /**
       * 출발 자리. 끄는 동안 "어디서 왔는지"를 흐리게 남겨두기 위한 값이라
       * 확정할 때는 쓰지 않는다.
       *
       * 레이아웃 데이터가 아니라 CSS 오버레이로 그린다 — 여기에 가짜 항목을 넣으면
       * 구글 이벤트가 유령 장애물이 되어 로컬 큐를 엉뚱하게 밀어낸다.
       */
      originDate: DateStr
      originStartOffset: number
    }
  | null

interface Props {
  days: DaySchedule[]
  today: DateStr
  dayStartHour: number
  moveUnitMinutes: number
  categories: CategoryRow[]
  nowOffset: number
  selectedId: string | null
  onSelect: (block: PlacedBlock | null, date: DateStr) => void
  onContextMenu: (state: ContextMenuState) => void
  mutate: (m: Mutation) => Promise<void>
}

export default function WeekGrid({
  days,
  today,
  dayStartHour,
  moveUnitMinutes,
  categories,
  nowOffset,
  selectedId,
  onSelect,
  onContextMenu,
  mutate,
}: Props) {
  const colorById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.base_color])),
    [categories],
  )
  const completableIds = useMemo(
    () => new Set(categories.filter((c) => c.completable === 1).map((c) => c.id)),
    [categories],
  )

  /**
   * 종일 일정이 가장 많은 날의 개수. 0이면 띠 자체를 그리지 않는다.
   * 모든 열이 이만큼 같은 높이를 쓰므로 열끼리 아래 내용이 어긋나지 않는다.
   */
  const maxAllDay = useMemo(
    () => days.reduce((max, d) => Math.max(max, d.allDayEvents.length), 0),
    [days],
  )

  const [draft, setDraft] = useState<Draft>(null)
  const [addingOn, setAddingOn] = useState<DateStr | null>(null)
  const bodyRefs = useRef(new Map<DateStr, HTMLDivElement>())

  /** 드래그 미리보기를 원본 데이터에 얹는다. */
  const withDraft = useCallback(
    (day: DaySchedule): DaySchedule => {
      if (!draft) return day

      if (draft.kind === 'reorder' && draft.date === day.date) {
        const byId = new Map(day.queue.map((q) => [q.id, q]))
        return { ...day, queue: draft.orderedIds.map((id) => byId.get(id)!).filter(Boolean) }
      }
      if (draft.kind === 'resize' && draft.date === day.date) {
        return {
          ...day,
          queue: day.queue.map((q) =>
            q.id === draft.id ? { ...q, durationMinutes: draft.durationMinutes } : q,
          ),
        }
      }
      if (draft.kind === 'moveFixed') {
        const key = draft.target === 'todo' ? 'todoSlots' : 'googleEvents'
        // 다른 날짜로 끌고 갔으면 원래 날짜에서 빼고 대상 날짜에 넣는다.
        const without = day[key].filter((s) => s.id !== draft.id)
        if (day.date !== draft.date) return { ...day, [key]: without }

        const original = days.flatMap((d) => d[key]).find((s) => s.id === draft.id)
        if (!original) return day
        return {
          ...day,
          [key]: [
            ...without,
            {
              ...original,
              startTime: fromDayOffset(draft.startOffset, dayStartHour),
              endTime: fromDayOffset(draft.startOffset + draft.durationMinutes, dayStartHour),
            },
          ],
        }
      }
      return day
    },
    [draft, days, dayStartHour],
  )

  const laidOut = useMemo(
    () =>
      days.map((raw) => {
        const day = withDraft(raw)
        return {
          day,
          ...layoutDay({
            anchorTime: day.anchorTime,
            dayStartHour,
            queue: day.queue,
            googleEvents: day.googleEvents,
            todoSlots: day.todoSlots,
          }),
        }
      }),
    [days, withDraft, dayStartHour],
  )

  const hours = Array.from({ length: 24 }, (_, i) => (dayStartHour + i) % 24)

  /*
   * 선택한 블록을 새로 계산된 것으로 계속 갈아끼운다.
   *
   * 선택 바는 블록 **객체**를 들고 있는데, 그 안의 시각·제목은 매번 layoutDay가 새로 만든
   * 파생값이다. 클릭한 순간의 객체를 그대로 쥐고 있으면 바에서 시각을 바꿔 저장해도
   * 바 자신은 옛 값을 계속 보여준다 (그리드만 바뀐다). 상세 패널이 id로 매번 다시 찾는 것과
   * 같은 이유다.
   *
   * 드래그 중(draft)에는 건드리지 않는다 — 포인터가 움직일 때마다 상위 상태가 바뀌면
   * 드래그가 무거워진다.
   */
  useEffect(() => {
    if (selectedId === null || draft !== null) return

    for (const { day, blocks } of laidOut) {
      const fresh = blocks.find((b) => b.id === selectedId)
      if (fresh) {
        onSelect(fresh, day.date)
        return
      }
    }
    // 지워졌거나 화면 밖으로 나갔으면 선택을 푼다.
    onSelect(null, laidOut[0]?.day.date ?? '')
  }, [laidOut, selectedId, draft, onSelect])

  // ── 열자마자 볼 것이 보이도록 한 번 스크롤 ────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  useEffect(() => {
    if (didScroll.current || !scrollRef.current || laidOut.length === 0) return
    const candidates = laidOut.flatMap(({ day, blocks }) => [
      toDayOffset(day.anchorTime, dayStartHour),
      ...blocks.map((b) => b.startOffset),
    ])
    candidates.push(nowOffset)
    scrollRef.current.scrollTop = Math.max(0, (Math.min(...candidates) - 30) * PX_PER_MINUTE)
    didScroll.current = true
  }, [laidOut, dayStartHour, nowOffset])

  /** 포인터 위치 → 그 날짜의 하루 시작 기준 분 */
  const offsetAt = useCallback((date: DateStr, clientY: number): number => {
    const el = bodyRefs.current.get(date)
    if (!el) return 0
    return (clientY - el.getBoundingClientRect().top) / PX_PER_MINUTE
  }, [])

  /** 포인터가 어느 날짜 열 위에 있는지 */
  const dateAt = useCallback(
    (clientX: number): DateStr | null => {
      for (const [date, el] of bodyRefs.current) {
        const r = el.getBoundingClientRect()
        if (clientX >= r.left && clientX <= r.right) return date
      }
      return null
    },
    [],
  )

  // ── 순서 드래그 ───────────────────────────────────────────────────────────
  const startReorder = (e: React.PointerEvent, date: DateStr, block: PlacedBlock) => {
    const day = days.find((d) => d.date === date)!
    const others = day.queue.filter((q) => q.id !== block.id)

    /**
     * 삽입 위치는 "끌고 있는 항목을 뺀 배치"의 중간점들로 판단한다.
     * 현재 화면의 배치를 기준으로 삼으면, 자리를 바꾸는 순간 뒤 항목들이 밀리며
     * 중간점도 함께 움직여 두 자리를 왕복하는 떨림이 생긴다.
     */
    const ghostFree = layoutDay({
      anchorTime: day.anchorTime,
      dayStartHour,
      queue: others,
      googleEvents: day.googleEvents,
      todoSlots: [],
    }).blocks.filter((b) => b.kind === 'local')

    const el = e.currentTarget as HTMLElement
    capturePointer(el, e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const y = offsetAt(date, ev.clientY)
      const index = ghostFree.filter((b) => (b.startOffset + b.endOffset) / 2 < y).length
      const next = [...others.map((q) => q.id)]
      next.splice(index, 0, block.id)
      setDraft({ kind: 'reorder', date, orderedIds: next })
    }

    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setDraft((current) => {
        if (current?.kind === 'reorder') {
          void mutate({ type: 'localEvent.reorder', date, orderedIds: current.orderedIds })
        }
        return null
      })
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // ── 소요시간 리사이즈 ──────────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent, date: DateStr, block: PlacedBlock) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    capturePointer(el, e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const raw = offsetAt(date, ev.clientY) - block.startOffset
      const durationMinutes = Math.max(moveUnitMinutes, snapToUnit(raw, moveUnitMinutes))
      setDraft({ kind: 'resize', date, id: block.id, durationMinutes })
    }

    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setDraft((current) => {
        if (current?.kind === 'resize') {
          void mutate({
            type: 'localEvent.update',
            id: current.id,
            patch: { durationMinutes: current.durationMinutes },
          })
        }
        return null
      })
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  /*
   * 절대 시각 블록 이동 — TODO 슬롯과 홀드한 구글 이벤트가 같은 경로를 쓴다.
   * 둘 다 밀림 계산 밖이라 옮기는 방식이 같고, 확정할 때 보내는 mutation만 갈린다.
   *
   * 구글은 네트워크 왕복이라 실패할 수 있는데, 되돌리기 코드는 따로 없다 —
   * 실패하면 캐시가 그대로이므로 다시 읽는 순간 블록이 원래 자리로 돌아간다.
   */
const startFixedMove = (e: React.PointerEvent, date: DateStr, block: PlacedBlock) => {
    const target = block.kind === 'google' ? 'google' : 'todo'
    const duration = block.endOffset - block.startOffset
    const grab = offsetAt(date, e.clientY) - block.startOffset
    const el = e.currentTarget as HTMLElement
    capturePointer(el, e.pointerId)

    const originStartOffset = block.startOffset

    const onMove = (ev: PointerEvent) => {
      const targetDate = dateAt(ev.clientX) ?? date
      const raw = offsetAt(targetDate, ev.clientY) - grab
      const startOffset = Math.min(
        MINUTES_PER_DAY - duration,
        Math.max(0, snapToUnit(raw, moveUnitMinutes)),
      )
      setDraft({
        kind: 'moveFixed',
        target,
        id: block.id,
        date: targetDate,
        startOffset,
        durationMinutes: duration,
        originDate: date,
        originStartOffset,
      })
    }

    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setDraft((current) => {
        if (current?.kind === 'moveFixed') {
          const patch = {
            date: current.date,
            startTime: fromDayOffset(current.startOffset, dayStartHour),
            endTime: fromDayOffset(current.startOffset + current.durationMinutes, dayStartHour),
          }
          void mutate(
            current.target === 'google'
              ? { type: 'googleEvent.update', id: current.id, patch }
              : { type: 'todoSlot.update', id: current.id, patch },
          )
        }
        return null
      })
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  /** 백로그에서 끌어다 놓으면 그 시각에 슬롯이 생기며 그리드로 승격된다. */
  const handleDrop = (e: React.DragEvent, date: DateStr) => {
    e.preventDefault()
    const todoId = e.dataTransfer.getData('text/todo-id')
    if (!todoId) return
    const startOffset = Math.max(0, snapToUnit(offsetAt(date, e.clientY), moveUnitMinutes))
    void mutate({
      type: 'todoSlot.create',
      todoId,
      date,
      startTime: fromDayOffset(startOffset, dayStartHour),
      endTime: fromDayOffset(startOffset + DEFAULT_SLOT_MINUTES, dayStartHour),
    })
  }

  return (
    <div
      className="grid"
      ref={scrollRef}
      style={{
        ['--day-h' as string]: `${MINUTES_PER_DAY * PX_PER_MINUTE}px`,
        /*
         * 종일 띠의 높이. 0이면 띠가 아예 없다.
         *
         * 날짜 머리 **밖**(위)에 있으므로 머리 높이는 언제나 그대로다. 다만 칩이
         * 자기 요일 열 위에 놓여야 하므로 열마다 셀을 두고, 그 셀들은 모두 같은 높이를 쓴다 —
         * 열마다 있는 만큼만 주면 그 아래 내용이 열끼리 어긋난다.
         */
        ['--all-day-h' as string]: `${maxAllDay * ALL_DAY_ROW_PX}px`,
      }}
    >
      <div className="axis">
        {maxAllDay > 0 && <div className="axis-all-day">종일</div>}
        <div className="axis-head" />
        {hours.map((h, i) => (
          <div key={i} className="axis-hour" style={{ top: i * 60 * PX_PER_MINUTE }}>
            {String(h).padStart(2, '0')}
          </div>
        ))}
      </div>

      {laidOut.map(({ day, blocks, overflow }) => (
        <div key={day.date} className={`day ${day.date === today ? 'is-today' : ''}`}>
          {/*
            종일 일정 — 날짜 머리 위, 자기 요일 열 안에 놓는다.
            머리 안에 두면 종일 일정이 있는 날만 머리가 커져 시간선이 어긋나므로 밖으로 뺐다.
            셀 높이는 --all-day-h로 모든 열이 같으며, 하나도 없으면 띠 자체가 없다.
          */}
          {maxAllDay > 0 && (
            <div className="all-day">
              {day.allDayEvents.map((e) => (
                <span key={e.id} className="all-day-chip" title={e.title}>
                  {e.title}
                </span>
              ))}
            </div>
          )}

          <DayHeader
            day={day}
            isToday={day.date === today}
            dayStartHour={dayStartHour}
            adding={addingOn === day.date}
            onToggleAdd={() => setAddingOn(addingOn === day.date ? null : day.date)}
            mutate={mutate}
          />

          <div
            className="day-body"
            ref={(el) => {
              if (el) bodyRefs.current.set(day.date, el)
              else bodyRefs.current.delete(day.date)
            }}
            style={{ height: 'var(--day-h)' }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, day.date)}
            onPointerDown={() => onSelect(null, day.date)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu({
                x: e.clientX,
                y: e.clientY,
                target: { kind: 'empty', date: day.date, offset: offsetAt(day.date, e.clientY) },
              })
            }}
          >
            {hours.map((_, i) => (
              <div key={i} className="hour-line" style={{ top: i * 60 * PX_PER_MINUTE }} />
            ))}

            <div
              className={`anchor-line ${day.anchorIsOverride ? 'is-override' : ''}`}
              style={{ top: toDayOffset(day.anchorTime, dayStartHour) * PX_PER_MINUTE }}
              title={`앵커 ${day.anchorTime}${day.anchorIsOverride ? '' : ' (요일 기본값)'}`}
            />

            {day.date === today && (
              <div className="now-line" style={{ top: nowOffset * PX_PER_MINUTE }} />
            )}

            {/*
              출발 자리 — 끄는 동안 "어디서 왔는지"를 남긴다.
              Block이 아니라 빈 상자다. 레이아웃에 끼우면 밀림 계산이 오염된다.
            */}
            {draft?.kind === 'moveFixed' && draft.originDate === day.date && (
              <div
                className="drag-origin"
                style={{
                  top: draft.originStartOffset * PX_PER_MINUTE,
                  height: draft.durationMinutes * PX_PER_MINUTE,
                }}
              />
            )}

            {blocks.map((b) => (
              <Block
                key={`${b.kind}-${b.id}`}
                block={b}
                date={day.date}
                dragging={draft?.kind === 'moveFixed' && draft.id === b.id}
                // 시간이 지났다는 것은 표시일 뿐 완료가 아니다 (TODO는 자동 완료되지 않는다).
                past={day.date < today || (day.date === today && b.endOffset <= nowOffset)}
                selected={selectedId === b.id}
                colorById={colorById}
                completableIds={completableIds}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onReorder={startReorder}
                onResize={startResize}
                onFixedMove={startFixedMove}
              />
            ))}

            {overflow.length > 0 && (
              <div className="overflow" title={overflow.map((o) => o.title).join(', ')}>
                +{overflow.length} 다음 날로 이월
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function DayHeader({
  day,
  isToday,
  dayStartHour,
  adding,
  onToggleAdd,
  mutate,
}: {
  day: DaySchedule
  isToday: boolean
  dayStartHour: number
  adding: boolean
  onToggleAdd: () => void
  mutate: (m: Mutation) => Promise<void>
}) {
  const [editingAnchor, setEditingAnchor] = useState(false)

  return (
    <div className="day-head">
      <div className="day-head-row">
        <span className="day-name">{WEEKDAY_KO[weekdayOf(day.date)]}</span>
        <span className="day-date">{day.date.slice(5)}</span>
        <button className="mini" title="일정 추가" onClick={onToggleAdd}>
          <Plus size={13} strokeWidth={2.2} />
        </button>
      </div>

      <div className="day-head-row">
        {editingAnchor ? (
          // 30분 단위로만 — 앵커는 큐 전체의 출발점이라 정밀할 이유가 없다
          <span className="anchor-input">
            <TimeField
              value={day.anchorTime}
              stepMinutes={ANCHOR_STEP_MINUTES}
              onChange={(anchorTime) =>
                void mutate({ type: 'anchor.set', date: day.date, anchorTime })
              }
            />
            <button className="mini" title="닫기" onClick={() => setEditingAnchor(false)}>
              <Check size={12} strokeWidth={2.4} />
            </button>
          </span>
        ) : (
          <button
            className={`anchor-btn ${day.anchorIsOverride ? 'is-override' : ''}`}
            title={
              day.anchorIsOverride
                ? '앵커 (직접 지정) — 우클릭하면 요일 기본값으로'
                : '앵커 (요일 기본값)'
            }
            onClick={() => setEditingAnchor(true)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (day.anchorIsOverride) void mutate({ type: 'anchor.clear', date: day.date })
            }}
          >
            <Anchor size={11} strokeWidth={2} /> {day.anchorTime}
          </button>
        )}

        {isToday && (
          <button
            className="mini"
            title="지금부터 — 앵커를 현재 시각으로"
            onClick={() => {
              const n = new Date()
              void mutate({
                type: 'anchor.set',
                date: day.date,
                anchorTime: fromDayOffset(
                  toDayOffset(
                    `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`,
                    dayStartHour,
                  ),
                  dayStartHour,
                ),
              })
            }}
          >
            <Play size={10} strokeWidth={2.2} fill="currentColor" /> 지금
          </button>
        )}
      </div>


      {adding && <QuickAdd date={day.date} onDone={onToggleAdd} mutate={mutate} />}
    </div>
  )
}

/** "밥 60"처럼 제목 뒤에 분을 붙여 한 줄로 넣는다. 숫자를 빼면 60분. */
function QuickAdd({
  date,
  onDone,
  mutate,
}: {
  date: DateStr
  onDone: () => void
  mutate: (m: Mutation) => Promise<void>
}) {
  return (
    <input
      className="quick-add"
      autoFocus
      placeholder="밥 60"
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return onDone()
        if (e.key !== 'Enter') return

        const raw = e.currentTarget.value.trim()
        if (!raw) return onDone()

        const match = /^(.*?)\s+(\d+)$/.exec(raw)
        const title = (match?.[1] ?? raw).trim()
        const durationMinutes = match ? Number(match[2]) : 60
        if (!title || durationMinutes <= 0) return

        void mutate({ type: 'localEvent.create', date, title, durationMinutes, categoryId: null })
        e.currentTarget.value = ''
      }}
    />
  )
}

function Block({
  block,
  date,
  past,
  selected,
  dragging,
  colorById,
  completableIds,
  onSelect,
  onContextMenu,
  onReorder,
  onResize,
  onFixedMove,
}: {
  block: PlacedBlock
  date: DateStr
  past: boolean
  selected: boolean
  /** 지금 끌리고 있는 블록 — 목적지 미리보기라 반투명하게 그린다 */
  dragging?: boolean
  colorById: Map<string, string>
  completableIds: Set<string>
  onSelect: (b: PlacedBlock | null, date: DateStr) => void
  onContextMenu: (state: ContextMenuState) => void
  onReorder: (e: React.PointerEvent, date: DateStr, b: PlacedBlock) => void
  onResize: (e: React.PointerEvent, date: DateStr, b: PlacedBlock) => void
  onFixedMove: (e: React.PointerEvent, date: DateStr, b: PlacedBlock) => void
}) {
  /*
   * 색의 출처가 둘이다.
   *   - 로컬·TODO: 카테고리 색 (사용자가 고른 것)
   *   - 구글: 구글에서 온 색을 채도만 눌러 만든 것 (shared/google-colors.ts)
   * 구글 쪽이 훨씬 흐리므로 "진하면 내 것, 흐리면 외부"라는 구분이 색만으로 읽힌다.
   */
  const base = block.categoryId ? colorById.get(block.categoryId) : block.meta.googleColor
  // 같은 카테고리가 연속되면 명도를 교차시켜 경계를 보이게 한다.
  // 글자는 검정으로 통일하므로 배경이 그걸 받쳐줄 만큼 밝은지도 함께 보장한다.
  const background = base
    ? ensureReadableBackground(alternateLightness(base, block.runIndex))
    : undefined
  /*
   * 왼쪽 띠는 모든 블록에 있다.
   *
   * 구글에만 띠가 있으면 나란히 놓았을 때 로컬·TODO가 허전해 보인다.
   * 배경은 검은 글자를 받치느라 밝은 쪽으로 몰려 카테고리끼리 비슷해 보이는데,
   * 띠는 어둡고 진해서 hue 차이가 바로 드러난다.
   */
  const accent = accentColor(base)

  /*
   * 홀드 중일 때만 움직일 수 있다 (평소엔 고정, 실수 방지).
   * 구글도 홀드하면 옮길 수 있고, 놓는 순간 구글 캘린더에 그대로 반영된다 —
   * 남의 서버를 실수로 고치는 일이 없도록 로컬보다 오히려 홀드가 더 중요하다.
   */
  const held = block.meta.isHeld === true
  const draggable = (block.kind !== 'todo' && held) || block.kind === 'todo'
  const showCheck =
    block.kind === 'todo' || (block.kind === 'local' && block.categoryId !== null &&
      completableIds.has(block.categoryId))

  // 예정 시각이 지난 미완료 TODO에만 "지남"을 붙인다.
  // 구글 이벤트는 남의 일정이고, 로컬 이벤트는 흐리게만 처리한다.
  const overdue = past && block.kind === 'todo' && block.meta.completed !== true

  // 짧은 블록은 시각을 아래가 아니라 오른쪽에 붙인다 (안 그러면 잘려 안 보인다).
  const heightPx = (block.endOffset - block.startOffset) * PX_PER_MINUTE
  const compact = heightPx < STACKED_BLOCK_MIN_PX

  return (
    <div
      className={[
        'block',
        `kind-${block.kind}`,
        compact && 'is-compact',
        selected && 'is-selected',
        dragging && 'is-dragging',
        held && 'is-held',
        past && 'is-past',
        block.meta.completed && 'is-done',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        top: block.startOffset * PX_PER_MINUTE,
        height: heightPx,
        /*
         * 겹친 TODO는 열을 나누지 않고 오른쪽으로 조금씩 밀어 얹는다 (stackIndex).
         * 겹치지 않으면 0이라 아무것도 안 밀린다.
         */
        left: `calc(${(block.column / block.columnCount) * 100}% + ${block.stackIndex * STACKED_TODO_OFFSET_PX}px)`,
        width: `calc(${100 / block.columnCount}% - ${block.stackIndex * STACKED_TODO_OFFSET_PX}px)`,
        // 뒤에 쌓인 것이 위로 오게 한다. 드래그 중(z-index 5)보다는 낮게 둔다.
        zIndex: block.stackIndex > 0 ? 1 + block.stackIndex : undefined,
        background,
        borderLeftColor: accent,
      }}
      title={`${block.title} ${block.startTime}~${block.endTime}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        // 우클릭은 선택만 하고 드래그를 시작하지 않는다 — 메뉴를 열려다 블록이 끌려가면 안 된다.
        if (e.button !== 0) return onSelect(block, date)
        onSelect(block, date)
        if (!draggable) return
        if (block.kind === 'local') onReorder(e, date, block)
        else onFixedMove(e, date, block)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'block', date, block } })
      }}
    >
      <span className="block-title">
        {showCheck && <i className={`check ${block.meta.completed ? 'on' : ''}`} />}
        {/* 구글에서 온 일정이라는 걸 왼쪽 띠만으로는 알아보기 어려워 아이콘을 함께 둔다. */}
        {block.kind === 'google' && <CalendarDays className="block-src" size={11} strokeWidth={2.5} />}
        {block.title}
      </span>
      <span className="block-time">
        {block.startTime}
        {overdue && <span className="overdue-badge">지남</span>}
      </span>

      {block.kind === 'local' && held && (
        <div className="resize-handle" onPointerDown={(e) => onResize(e, date, block)} />
      )}
    </div>
  )
}

export type { PlacedBlock, QueueItem }
