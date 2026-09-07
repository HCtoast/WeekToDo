import { useRef, useState } from 'react'
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
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
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

/** 제목 입력 줄의 크기 — 화면 밖으로 나가지 않게 미리 당길 때 쓴다 (ContextMenu.css와 맞춰둘 것) */
const PROMPT_WIDTH = 226
const PROMPT_HEIGHT = 34

/**
 * 그리드 우클릭 메뉴.
 *
 * 네이티브 메뉴 대신 HTML로 그리는 이유: 반투명 유리 위젯에서 OS 메뉴만 불투명한 회색으로
 * 튀고, 항목마다 아이콘을 넣거나 그 자리에서 제목을 입력받기도 어렵다.
 *
 * Radix `DropdownMenu` 위에 얹었다. 방향키·Home/End·타이핑 점프·Esc·바깥 클릭·화면 밖
 * 충돌 회피를 전부 Radix가 처리한다 — 예전에는 이걸 손으로 계산했다.
 * 트리거로 쓰는 것은 우클릭한 좌표에 놓는 **크기 0짜리 앵커**다. 메뉴는 늘 열린 채로
 * 마운트되고(`open`), 닫히는 순간 부모가 언마운트한다.
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
  /** 제목을 받아야 하는 항목을 고르면 메뉴가 입력 줄로 바뀐다 */
  const [prompt, setPrompt] = useState<'todo' | 'event' | 'google' | null>(null)
  /**
   * 구글 삭제 확인 모달. 메뉴가 닫힌 뒤에도 살아 있어야 하므로 메뉴 바깥에 둔다 —
   * 안에 두면 항목을 누르는 순간 메뉴와 함께 언마운트되어 모달이 뜨지 못한다.
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)

  /**
   * 항목을 골라 **다음 화면으로 넘어가는 중**이라는 표시.
   *
   * Radix는 항목을 고르면 메뉴를 닫고 `onOpenChange(false)`를 부른다. 거기서 그대로
   * `onClose()`를 하면 부모가 이 컴포넌트를 통째로 언마운트해서, 이어서 떠야 할
   * 입력 줄이나 모달이 뜨기도 전에 사라진다 (실제로 "이 시각에 TODO"가 먹통이었다).
   *
   * 상태로 판단하면 안 된다 — 상태 갱신이 반영되기 전에 `onOpenChange`가 올 수 있다.
   * ref는 그 자리에서 바뀌므로 순서에 기대지 않는다.
   */
  const goingElsewhere = useRef(false)

  const openPrompt = (kind: 'todo' | 'event' | 'google'): void => {
    goingElsewhere.current = true
    setPrompt(kind)
  }

  const confirmDelete = (target: { id: string; title: string }): void => {
    goingElsewhere.current = true
    setPendingDelete(target)
  }

  const run = (m: Mutation): void => {
    void mutate(m)
    onClose()
  }

  const icon = { size: 14, strokeWidth: 1.8 }

  // 제목 입력 모드. 메뉴 항목 사이에 <input>을 두면 Radix가 키 입력을
  // 타이핑 점프로 가로채므로, 이때는 메뉴를 걷어내고 입력 줄만 띄운다.
  if (prompt) {
    const label =
      prompt === 'todo'
        ? 'TODO 제목'
        : prompt === 'google'
          ? '구글에 저장할 일정 제목'
          : '일정 제목 (뒤에 숫자를 붙이면 분)'
    return (
      <div
        className="ctxmenu ctxmenu-prompt"
        style={{
          // 예전에는 렌더 후 크기를 재서 당겼지만, 이 줄은 폭이 고정이라 미리 계산하면 된다.
          left: Math.max(4, Math.min(state.x, window.innerWidth - PROMPT_WIDTH - 4)),
          top: Math.max(4, Math.min(state.y, window.innerHeight - PROMPT_HEIGHT - 4)),
        }}
      >
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
              // "회의 90" 처럼 뒤에 숫자를 붙이면 그게 소요시간이다.
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
    <>
      <DropdownMenu
        open={pendingDelete === null}
        onOpenChange={(open) => {
          if (open) return
          // 다음 화면으로 넘어가는 중이면 닫지 않는다. 아니면 바깥 클릭·Esc이므로 끝낸다.
          if (goingElsewhere.current) return
          onClose()
        }}
        // 위젯은 늘 떠 있는 창이라 body의 포인터 이벤트를 잠그지 않는다.
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <span className="ctx-anchor" style={{ left: state.x, top: state.y }} />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="min-w-44">
          {state.target.kind === 'empty' ? (
            <EmptyItems
              date={state.target.date}
              offset={state.target.offset}
              dayStartHour={dayStartHour}
              moveUnitMinutes={moveUnitMinutes}
              icon={icon}
              run={run}
              onPrompt={openPrompt}
            />
          ) : (
            <BlockItems
              block={state.target.block}
              icon={icon}
              run={run}
              onConfirmDelete={confirmDelete}
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
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        구글 삭제만 확인을 받는다 — 이 앱에서 유일하게 되돌릴 수 없는 조작이다.
        나머지(로컬 일정·TODO)는 우리 DB 안이라 되살릴 수 있으므로 바로 실행한다.
      */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
            onClose()
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>구글에서 삭제할까요?</DialogTitle>
            <DialogDescription>
              <strong>{pendingDelete?.title}</strong> 을(를) 구글 캘린더에서 지웁니다. 이 앱에서만
              사라지는 게 아니라 <strong>구글에서도 사라지며, 되돌릴 수 없습니다.</strong>
            </DialogDescription>
          </DialogHeader>
          {/*
            원본 DialogFooter는 `sm`(640px) 아래에서 flex-col-reverse로 쌓인다.
            이 위젯은 그 폭을 넘는 일이 없어 늘 세로로 쌓이고, 그러면 위험한 쪽이 위로 온다.
            가로로 고정해 "취소 | 삭제" 순서를 지킨다.
          */}
          <DialogFooter className="flex-row justify-end">
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              취소
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (pendingDelete) run({ type: 'googleEvent.delete', id: pendingDelete.id })
                setPendingDelete(null)
              }}
            >
              구글에서 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmptyItems({
  date,
  offset,
  dayStartHour,
  moveUnitMinutes,
  icon,
  run,
  onPrompt,
}: {
  date: DateStr
  offset: number
  dayStartHour: number
  moveUnitMinutes: number
  icon: { size: number; strokeWidth: number }
  run: (m: Mutation) => void
  onPrompt: (p: 'todo' | 'event' | 'google') => void
}) {
  return (
    <>
      <DropdownMenuLabel className="text-caption text-fg-muted">
        {fromDayOffset(snapToUnit(offset, moveUnitMinutes), dayStartHour)}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onPrompt('todo')}>
        <ListPlus {...icon} /> 이 시각에 TODO
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onPrompt('event')}>
        <CalendarPlus {...icon} /> 일정 추가 (큐 맨 뒤)
      </DropdownMenuItem>
      {/* 위 둘은 로컬에만 남고, 이것만 실제 구글 캘린더에 저장된다. */}
      <DropdownMenuItem onSelect={() => onPrompt('google')}>
        <CalendarDays {...icon} /> 구글에 일정 만들기
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() =>
          run({
            type: 'anchor.set',
            date,
            anchorTime: fromDayOffset(snapToUnit(offset, moveUnitMinutes), dayStartHour),
          })
        }
      >
        <Anchor {...icon} /> 앵커를 여기로
      </DropdownMenuItem>
    </>
  )
}

function BlockItems({
  block,
  icon,
  run,
  onConfirmDelete,
  onOpenDetail,
  onOpenGoogleDetail,
}: {
  block: PlacedBlock
  icon: { size: number; strokeWidth: number }
  run: (m: Mutation) => void
  onConfirmDelete: (target: { id: string; title: string }) => void
  onOpenDetail: (todoId: string) => void
  onOpenGoogleDetail: (googleEventId: string) => void
}) {
  const held = block.meta.isHeld === true
  const done = block.meta.completed === true

  if (block.kind === 'google') {
    return (
      <>
        <DropdownMenuLabel className="max-w-56 truncate text-caption text-fg-muted">
          {block.title}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpenGoogleDetail(block.id)}>
          <Pencil {...icon} /> 상세 편집 (구글에 반영)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => run({ type: 'googleEvent.setHeld', id: block.id, isHeld: !held })}
        >
          {held ? <LockOpen {...icon} /> : <Lock {...icon} />}
          {held ? '홀드 해제 (고정)' : '홀드 — 드래그 허용'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="danger"
          onSelect={() => onConfirmDelete({ id: block.id, title: block.title })}
        >
          <Trash2 {...icon} /> 구글에서 삭제…
        </DropdownMenuItem>
      </>
    )
  }

  if (block.kind === 'todo') {
    const todoId = block.meta.todoId
    return (
      <>
        <DropdownMenuLabel className="max-w-56 truncate text-caption text-fg-muted">
          {block.title}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => todoId && onOpenDetail(todoId)}>
          <Pencil {...icon} /> 상세 편집
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            todoId && run({ type: 'todo.update', id: todoId, patch: { completed: !done } })
          }
        >
          <Check {...icon} /> {done ? '완료 취소' : '완료'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run({ type: 'todoSlot.delete', id: block.id })}>
          <Undo2 {...icon} /> 시간대 해제
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="danger"
          onSelect={() => todoId && run({ type: 'todo.delete', id: todoId })}
        >
          <Trash2 {...icon} /> TODO 삭제
        </DropdownMenuItem>
      </>
    )
  }

  return (
    <>
      <DropdownMenuLabel className="max-w-56 truncate text-caption text-fg-muted">
          {block.title}
        </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => run({ type: 'localEvent.update', id: block.id, patch: { isHeld: !held } })}
      >
        {held ? <LockOpen {...icon} /> : <Lock {...icon} />}
        {held ? '홀드 해제 (고정)' : '홀드 — 드래그 허용'}
      </DropdownMenuItem>
      {done !== undefined && (
        <DropdownMenuItem
          onSelect={() =>
            run({ type: 'localEvent.update', id: block.id, patch: { completed: !done } })
          }
        >
          <Check {...icon} /> {done ? '완료 취소' : '완료'}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="danger"
        onSelect={() => run({ type: 'localEvent.delete', id: block.id })}
      >
        <Trash2 {...icon} /> 일정 삭제
      </DropdownMenuItem>
    </>
  )
}
