import { Ellipsis, Lock, LockOpen, Trash2, Undo2, X } from 'lucide-react'
import type { Mutation } from '@shared/ipc-contract'
import type { CategoryRow, DateStr } from '@shared/types'
import { adjustRangeEnd, adjustRangeStart, type PlacedBlock } from '@shared/scheduler'
import { TIME_STEP_MINUTES } from '@shared/constants'
import { ICON_SIZE, ICON_STROKE } from '@renderer/components/WidgetChrome/WidgetChrome'
import TimeField from '@renderer/components/TimeField/TimeField'
import './SelectionBar.css'

const icon = { size: ICON_SIZE, strokeWidth: ICON_STROKE }

/**
 * 선택한 블록의 액션 모음.
 *
 * 블록 위 팝오버 대신 하단 고정 바를 쓰는 이유: 30분짜리 블록은 높이가 20px 남짓이라
 * 그 안에 버튼을 넣거나 옆에 팝오버를 띄우면 위젯 밖으로 나가거나 서로 겹친다.
 */
export default function SelectionBar({
  block,
  date,
  categories,
  mutate,
  onOpenDetail,
  onOpenGoogleDetail,
  onClose,
}: {
  block: PlacedBlock
  date: DateStr
  categories: CategoryRow[]
  mutate: (m: Mutation) => Promise<void>
  onOpenDetail: (todoId: string) => void
  onOpenGoogleDetail: (googleEventId: string) => void
  onClose: () => void
}) {
  const isLocal = block.kind === 'local'
  const isTodo = block.kind === 'todo'
  const isGoogle = block.kind === 'google'
  const held = block.meta.isHeld === true

  return (
    <div className="selbar">
      <span className="selbar-title" title={block.title}>
        {block.title}
      </span>
      {/*
        TODO 슬롯은 절대 시각이라 여기서 바로 고칠 수 있다.
        로컬 이벤트는 시작 시각을 저장하지 않으므로(앵커 + 누적) 값을 넣을 자리가 없고,
        구글은 저장이 네트워크를 타서 실패를 보여줄 자리가 필요하다 — 둘 다 읽기로 둔다.
      */}
      {isTodo ? (
        <span className="selbar-time is-edit">
          <TimeField
            value={block.startTime}
            stepMinutes={TIME_STEP_MINUTES}
            title="시작 시각"
            // 뒤집힐 때만 종료를 함께 민다 — 넘었다고 막지 않는다.
            onChange={(t) =>
              void mutate({
                type: 'todoSlot.update',
                id: block.id,
                patch: adjustRangeStart(block.startTime, block.endTime, t),
              })
            }
          />
          ~
          <TimeField
            value={block.endTime}
            stepMinutes={TIME_STEP_MINUTES}
            title="종료 시각"
            onChange={(t) =>
              void mutate({
                type: 'todoSlot.update',
                id: block.id,
                patch: adjustRangeEnd(block.startTime, block.endTime, t),
              })
            }
          />
        </span>
      ) : (
        <span className="selbar-time">
          {block.startTime}~{block.endTime}
        </span>
      )}

      {(isLocal || isGoogle) && (
        <button
          className={`mini ${held ? 'active' : ''}`}
          title={
            isGoogle
              ? held
                ? '홀드 해제 — 다시 고정한다'
                : '홀드 — 끌어서 옮기면 구글 캘린더가 바뀝니다'
              : held
                ? '홀드 해제 (고정)'
                : '홀드 — 드래그로 순서/길이 변경'
          }
          onClick={() =>
            void mutate(
              isGoogle
                ? { type: 'googleEvent.setHeld', id: block.id, isHeld: !held }
                : { type: 'localEvent.update', id: block.id, patch: { isHeld: !held } },
            )
          }
        >
          {held ? <LockOpen {...icon} /> : <Lock {...icon} />}
        </button>
      )}

      <select
        className="selbar-cat"
        value={block.categoryId ?? ''}
        disabled={block.kind === 'google'}
        onChange={(e) => {
          const categoryId = e.target.value || null
          if (isLocal) void mutate({ type: 'localEvent.update', id: block.id, patch: { categoryId } })
          else if (isTodo && block.meta.todoId)
            void mutate({ type: 'todo.update', id: block.meta.todoId, patch: { categoryId } })
        }}
      >
        <option value="">미분류</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {isGoogle && (
        <button
          className="mini"
          title="상세 — 제목 · 시각 · 장소 · 설명 (구글에 반영됩니다)"
          onClick={() => onOpenGoogleDetail(block.id)}
        >
          <Ellipsis {...icon} />
        </button>
      )}

      {isTodo && block.meta.todoId && (
        <>
          <button
            className="mini"
            title="상세 — 설명 · 링크 · 마감"
            onClick={() => onOpenDetail(block.meta.todoId!)}
          >
            <Ellipsis {...icon} />
          </button>
          <button
            className="mini"
            title="시간대 해제 — 미배치 목록으로"
            onClick={() => {
              void mutate({ type: 'todoSlot.delete', id: block.id })
              onClose()
            }}
          >
            <Undo2 {...icon} />
          </button>
        </>
      )}

      {block.kind !== 'google' && (
        <button
          className="mini danger"
          title="삭제"
          onClick={() => {
            if (isLocal) void mutate({ type: 'localEvent.delete', id: block.id })
            else if (block.meta.todoId)
              void mutate({ type: 'todo.delete', id: block.meta.todoId })
            onClose()
          }}
        >
          <Trash2 {...icon} />
        </button>
      )}

      <button className="mini" title="선택 해제" onClick={onClose}>
        <X {...icon} />
      </button>
      <span className="selbar-date">{date.slice(5)}</span>
    </div>
  )
}
