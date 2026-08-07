import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Anchor,
  CalendarDays,
  CalendarPlus,
  Check,
  ListPlus,
  Lock,
  LockOpen,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { Mutation } from '@shared/ipc-contract'
import type { DateStr } from '@shared/types'
import { NEW_GOOGLE_EVENT_MINUTES } from '@shared/constants'
import { fromDayOffset, snapToUnit, type PlacedBlock } from '@shared/scheduler'
import './ContextMenu.css'

/** 우클릭한 대상 — 빈 칸이면 시각, 블록이면 그 블록 */
export type ContextTarget =
  | { kind: 'empty'; date: DateStr; offset: number }
  | { kind: 'block'; date: DateStr; block: PlacedBlock }

export interface ContextMenuState {
  x: number
  y: number
  target: ContextTarget
}

/** 새로 만드는 TODO 슬롯의 기본 길이 */
const NEW_SLOT_MINUTES = 60
/** 새로 만드는 로컬 일정의 기본 소요시간 */
const NEW_EVENT_MINUTES = 60

/**
 * 그리드 우클릭 메뉴.
 *
 * 네이티브 메뉴 대신 HTML로 그리는 이유: 반투명 유리 위젯에서 OS 메뉴만 불투명한 회색으로
 * 튀고, 항목마다 아이콘을 넣거나 그 자리에서 제목을 입력받기도 어렵다.
 */
export default function ContextMenu({
  state,
  dayStartHour,
  moveUnitMinutes,
  mutate,
  onOpenDetail,
  onOpenGoogleDetail,
  onClose,
}: {
  state: ContextMenuState
  dayStartHour: number
  moveUnitMinutes: number
  mutate: (m: Mutation) => Promise<void>
  onOpenDetail: (todoId: string) => void
  onOpenGoogleDetail: (googleEventId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: state.x, y: state.y })
  /** 제목을 받아야 하는 항목을 고르면 메뉴가 입력 줄로 바뀐다 */
  const [prompt, setPrompt] = useState<'todo' | 'event' | 'google' | null>(null)

  // 창 밖으로 삐져나가면 안쪽으로 당긴다.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(state.x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(state.y, window.innerHeight - height - 4)),
    })
  }, [state.x, state.y, prompt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = (m: Mutation): void => {
    void mutate(m)
    onClose()
  }

  const icon = { size: 14, strokeWidth: 1.8 }

  if (prompt) {
    const label =
      prompt === 'todo'
        ? 'TODO 제목'
        : prompt === 'google'
          ? '구글에 저장할 일정 제목'
          : '일정 제목 (뒤에 숫자를 붙이면 분)'
    return (
      <div className="ctxmenu" ref={ref} style={{ left: pos.x, top: pos.y }}>
        <input
          className="ctx-input"
          autoFocus
          placeholder={label}
          onBlur={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return onClose()
            if (e.key !== 'Enter') return

            const raw = e.currentTarget.value.trim()
            if (!raw || state.target.kind !== 'empty') return onClose()

            if (prompt === 'todo') {
              const start = snapToUnit(state.target.offset, moveUnitMinutes)
              run({
                type: 'todo.createAt',
                title: raw,
                date: state.target.date,
                startTime: fromDayOffset(start, dayStartHour),
                endTime: fromDayOffset(start + NEW_SLOT_MINUTES, dayStartHour),
              })
            } else if (prompt === 'google') {
              const start = snapToUnit(state.target.offset, moveUnitMinutes)
              run({
                type: 'googleEvent.create',
                title: raw,
                date: state.target.date,
                startTime: fromDayOffset(start, dayStartHour),
                endTime: fromDayOffset(start + NEW_GOOGLE_EVENT_MINUTES, dayStartHour),
              })
            } else {
              // "과제 90"처럼 뒤 숫자를 소요시간으로 읽는다 (빠른 추가와 같은 규칙)
              const m = /^(.*?)\s+(\d+)$/.exec(raw)
              run({
                type: 'localEvent.create',
                date: state.target.date,
                title: (m?.[1] ?? raw).trim(),
                durationMinutes: m ? Number(m[2]) : NEW_EVENT_MINUTES,
                categoryId: null,
              })
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="ctxmenu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {state.target.kind === 'empty' ? (
        <>
          <div className="ctx-head">
            {fromDayOffset(snapToUnit(state.target.offset, moveUnitMinutes), dayStartHour)}
          </div>
          <button onClick={() => setPrompt('todo')}>
            <ListPlus {...icon} /> 이 시각에 TODO
          </button>
          <button onClick={() => setPrompt('event')}>
            <CalendarPlus {...icon} /> 일정 추가 (큐 맨 뒤)
          </button>
          {/* 위 둘은 로컬에만 남고, 이것만 실제 구글 캘린더에 저장된다. */}
          <button onClick={() => setPrompt('google')}>
            <CalendarDays {...icon} /> 구글에 일정 만들기
          </button>
          <hr />
          <button
            onClick={() =>
              state.target.kind === 'empty' &&
              run({
                type: 'anchor.set',
                date: state.target.date,
                anchorTime: fromDayOffset(
                  snapToUnit(state.target.offset, moveUnitMinutes),
                  dayStartHour,
                ),
              })
            }
          >
            <Anchor {...icon} /> 앵커를 여기로
          </button>
        </>
      ) : (
        <BlockItems
          block={state.target.block}
          icon={icon}
          run={run}
          onOpenDetail={(id) => {
            onOpenDetail(id)
            onClose()
          }}
          onOpenGoogleDetail={(id) => {
            onOpenGoogleDetail(id)
            onClose()
          }}
        />
      )}
    </div>
  )
}

function BlockItems({
  block,
  icon,
  run,
  onOpenDetail,
  onOpenGoogleDetail,
}: {
  block: PlacedBlock
  icon: { size: number; strokeWidth: number }
  run: (m: Mutation) => void
  onOpenDetail: (todoId: string) => void
  onOpenGoogleDetail: (googleEventId: string) => void
}) {
  const held = block.meta.isHeld === true
  const done = block.meta.completed === true
  /** 구글 삭제만 두 번 눌러야 나간다 — 이 앱에서 유일하게 되돌릴 수 없는 조작이다 */
  const [confirming, setConfirming] = useState(false)

  if (block.kind === 'google') {
    return (
      <>
        <div className="ctx-head">{block.title}</div>
        <button onClick={() => onOpenGoogleDetail(block.id)}>
          <Pencil {...icon} /> 상세 편집 (구글에 반영)
        </button>
        <button
          onClick={() => run({ type: 'googleEvent.setHeld', id: block.id, isHeld: !held })}
        >
          {held ? <LockOpen {...icon} /> : <Lock {...icon} />}
          {held ? '홀드 해제 (고정)' : '홀드 — 드래그 허용'}
        </button>
        <hr />
        {/*
          되돌릴 수 없는 유일한 조작이라 두 번 눌러야 나간다.
          한 번 누르면 문구가 바뀌고, 그때 다시 눌러야 실제로 지워진다.
        */}
        <button className="danger" onClick={() => (confirming ? run({ type: 'googleEvent.delete', id: block.id }) : setConfirming(true))}>
          <Trash2 {...icon} />
          {confirming ? '정말 구글에서 지웁니다 — 한 번 더' : '구글에서 삭제'}
        </button>
        {confirming && <p className="ctx-note">되돌릴 수 없습니다.</p>}
      </>
    )
  }

  if (block.kind === 'todo') {
    const todoId = block.meta.todoId
    return (
      <>
        <div className="ctx-head">{block.title}</div>
        <button onClick={() => todoId && onOpenDetail(todoId)}>
          <Pencil {...icon} /> 상세 편집
        </button>
        <button
          onClick={() =>
            todoId && run({ type: 'todo.update', id: todoId, patch: { completed: !done } })
          }
        >
          <Check {...icon} /> {done ? '완료 취소' : '완료'}
        </button>
        <button onClick={() => run({ type: 'todoSlot.delete', id: block.id })}>
          <Undo2 {...icon} /> 시간대 해제
        </button>
        <hr />
        <button
          className="danger"
          onClick={() => todoId && run({ type: 'todo.delete', id: todoId })}
        >
          <Trash2 {...icon} /> TODO 삭제
        </button>
      </>
    )
  }

  return (
    <>
      <div className="ctx-head">{block.title}</div>
      <button
        onClick={() => run({ type: 'localEvent.update', id: block.id, patch: { isHeld: !held } })}
      >
        {held ? <LockOpen {...icon} /> : <Lock {...icon} />}
        {held ? '홀드 해제 (고정)' : '홀드 — 드래그 허용'}
      </button>
      {done !== undefined && (
        <button
          onClick={() =>
            run({ type: 'localEvent.update', id: block.id, patch: { completed: !done } })
          }
        >
          <Check {...icon} /> {done ? '완료 취소' : '완료'}
        </button>
      )}
      <hr />
      <button className="danger" onClick={() => run({ type: 'localEvent.delete', id: block.id })}>
        <Trash2 {...icon} /> 일정 삭제
      </button>
    </>
  )
}
