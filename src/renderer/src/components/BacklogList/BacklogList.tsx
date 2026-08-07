import { useState } from 'react'
import { Check, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { TodoData, Mutation } from '@shared/ipc-contract'
import type { CategoryRow } from '@shared/types'
import { formatCountdown } from '@shared/deadline'
import { ESCAPE_ATTR } from '@renderer/hooks/useClickThroughEscape'
import './BacklogList.css'

/**
 * 아직 시간을 정하지 않은 TODO. 그리드로 끌어다 놓으면 슬롯이 생기며 승격된다.
 * 여기 항목은 날짜 개념이 없으므로 하루 경계 이월의 대상도 아니다.
 */
export default function BacklogList({
  todos,
  categories,
  now,
  mutate,
  onOpenDetail,
}: {
  todos: TodoData[]
  categories: CategoryRow[]
  now: Date
  mutate: (m: Mutation) => Promise<void>
  onOpenDetail: (todo: TodoData) => void
}) {
  const [adding, setAdding] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const colorOf = (id: string | null) =>
    categories.find((c) => c.id === id)?.base_color ?? 'var(--text-dim)'

  return (
    <section className="backlog">
      <header>
        <h3>미배치 TODO {todos.length > 0 && `(${todos.length})`}</h3>
        {/* 말로 시키기 — 손으로 추가하는 + 바로 왼쪽에 둬서 둘이 짝으로 읽히게 한다. */}
        <button
          className="mini"
          title="말로 시키기 — 한 줄 치면 바로 반영됩니다"
          onClick={() => void window.api.openCommandWindow()}
          {...{ [ESCAPE_ATTR]: '' }}
        >
          <Sparkles size={14} strokeWidth={2} />
        </button>
        <button className="mini" title="TODO 추가" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={2.2} />
        </button>
      </header>

      {adding && (
        <input
          className="quick-add"
          autoFocus
          placeholder="할 일"
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setAdding(false)
            if (e.key !== 'Enter') return
            const title = e.currentTarget.value.trim()
            if (!title) return setAdding(false)
            void mutate({ type: 'todo.create', title, categoryId: null })
            e.currentTarget.value = ''
          }}
        />
      )}

      {todos.length === 0 && !adding ? (
        <p className="empty">없음</p>
      ) : (
        <ul>
          {todos.map((t, index) => (
            <li
              key={t.id}
              className={t.completed ? 'done' : ''}
              draggable
              onDragStart={(e) => {
                // 그리드에 놓으면 슬롯 생성, 리스트 안에서 놓으면 순서 변경.
                e.dataTransfer.setData('text/todo-id', t.id)
                e.dataTransfer.effectAllowed = 'copyMove'
                setDragIndex(index)
              }}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragIndex === null || dragIndex === index) return
                const ids = todos.map((x) => x.id)
                const [moved] = ids.splice(dragIndex, 1)
                ids.splice(index, 0, moved!)
                void mutate({ type: 'todo.reorderBacklog', orderedIds: ids })
                setDragIndex(null)
              }}
            >
              <button
                className={`check ${t.completed ? 'on' : ''}`}
                title={t.completed ? '완료 취소' : '완료'}
                onClick={() =>
                  void mutate({ type: 'todo.update', id: t.id, patch: { completed: !t.completed } })
                }
              >
                {t.completed && <Check size={12} strokeWidth={3} />}
              </button>
              <i className="dot" style={{ background: colorOf(t.categoryId) }} />
              <button
                className="backlog-title"
                title="상세 보기"
                onClick={() => onOpenDetail(t)}
              >
                {t.title}
              </button>
              {(() => {
                // 카운트다운은 저장하지 않고 그릴 때마다 계산한다.
                const c = formatCountdown(t.deadline, now)
                return c && !t.completed ? (
                  <span className={`due level-${c.level}`} title={c.full}>
                    {c.compact}
                  </span>
                ) : null
              })()}
              <button
                className="mini danger"
                title="삭제"
                onClick={() => void mutate({ type: 'todo.delete', id: t.id })}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
