import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { TodoData, Mutation } from '@shared/ipc-contract'
import type { CategoryRow } from '@shared/types'
import { formatCountdown, type DeadlineType } from '@shared/deadline'
import { TIME_STEP_MINUTES } from '@shared/constants'
import { adjustRangeEnd, adjustRangeStart } from '@shared/scheduler'
import TimeField from '@renderer/components/TimeField/TimeField'
import './TodoDetail.css'

/**
 * TODO 상세. 설명·링크·마감처럼 그리드 블록에 넣을 수 없는 정보를 여기서 본다.
 *
 * 텍스트 입력은 blur에서 저장한다. 글자마다 IPC를 왕복하면 매 타이핑이 전체 재조회를 부른다.
 */
/** 이 TODO가 그리드에 배치돼 있으면 그 슬롯 */
export interface TodoSlotRef {
  id: string
  date: string
  startTime: string
  endTime: string
}

export default function TodoDetail({
  todo,
  slot,
  categories,
  now,
  mutate,
  onClose,
}: {
  todo: TodoData
  slot: TodoSlotRef | null
  categories: CategoryRow[]
  now: Date
  mutate: (m: Mutation) => Promise<void>
  onClose: () => void
}) {
  const [type, setType] = useState<DeadlineType | ''>(todo.deadlineType ?? '')

  // 다른 TODO를 선택하면 폼 상태도 따라가야 한다.
  useEffect(() => setType(todo.deadlineType ?? ''), [todo.id, todo.deadlineType])

  const countdown = formatCountdown(todo.deadline, now)
  const patch = (p: Extract<Mutation, { type: 'todo.update' }>['patch']): void =>
    void mutate({ type: 'todo.update', id: todo.id, patch: p })

  /** 절대 마감을 날짜/시각 두 칸으로 나눠 보여준다. 없으면 오늘 자정 직전을 기본으로 */
  const absolute = splitLocal(todo.deadline)
  const saveAbsolute = (date: string, time: string): void =>
    patch({ deadline: { type: 'absolute', absolute: new Date(`${date}T${time}`).toISOString() } })

  return (
    <div className="detail">
      <header>
        <input
          className="detail-title"
          defaultValue={todo.title}
          key={`${todo.id}-title`}
          onBlur={(e) => {
            const title = e.target.value.trim()
            if (title && title !== todo.title) patch({ title })
          }}
        />
        <button className="chrome-btn" onClick={onClose} title="닫기">
          <X size={15} strokeWidth={1.75} />
        </button>
      </header>

      <div className="detail-body">
        <label className="field">
          <span>카테고리</span>
          <select
            value={todo.categoryId ?? ''}
            onChange={(e) => patch({ categoryId: e.target.value || null })}
          >
            <option value="">미분류</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {slot ? (
          <>
            <label className="field">
              <span>날짜</span>
              <input
                type="date"
                key={`${slot.id}-date`}
                defaultValue={slot.date}
                onChange={(e) => {
                  if (e.target.value)
                    void mutate({
                      type: 'todoSlot.update',
                      id: slot.id,
                      patch: { date: e.target.value },
                    })
                }}
              />
            </label>

            <label className="field">
              <span>시간</span>
              <span className="inline">
                <TimeField
                  value={slot.startTime}
                  stepMinutes={TIME_STEP_MINUTES}
                  // 뒤집힐 때만 종료를 함께 민다 — 넘었다고 막지 않는다.
                  onChange={(t) =>
                    void mutate({
                      type: 'todoSlot.update',
                      id: slot.id,
                      patch: adjustRangeStart(slot.startTime, slot.endTime, t),
                    })
                  }
                />
                ~
                <TimeField
                  value={slot.endTime}
                  stepMinutes={TIME_STEP_MINUTES}
                  onChange={(t) =>
                    void mutate({
                      type: 'todoSlot.update',
                      id: slot.id,
                      patch: adjustRangeEnd(slot.startTime, slot.endTime, t),
                    })
                  }
                />
              </span>
            </label>

            <button
              className="unslot"
              onClick={() => void mutate({ type: 'todoSlot.delete', id: slot.id })}
            >
              시간대 해제 — 미배치 목록으로
            </button>
          </>
        ) : (
          <p className="hint">
            아직 시간대가 없습니다. 그리드로 끌어다 놓거나 빈 칸을 우클릭해 배치하세요.
          </p>
        )}

        <label className="field">
          <span>마감</span>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as DeadlineType | ''
              setType(next)
              if (next === '') patch({ deadline: { type: null } })
            }}
          >
            <option value="">없음</option>
            <option value="absolute">날짜 지정</option>
            <option value="relative">생성 후 N일</option>
          </select>
        </label>

        {type === 'absolute' && (
          /*
           * 날짜와 시각을 나눠 받는다.
           * `datetime-local` 하나로 받으면 시각 쪽이 네이티브 피커라 1분 단위를 고를 수 있다
           * (Chromium이 step을 무시한다 — TimeField 주석 참고).
           */
          <span className="inline field-wide">
            <input
              type="date"
              key={`${todo.id}-abs-date`}
              defaultValue={absolute.date}
              onChange={(e) => {
                if (e.target.value) saveAbsolute(e.target.value, absolute.time)
              }}
            />
            <TimeField
              value={absolute.time}
              stepMinutes={TIME_STEP_MINUTES}
              onChange={(time) => saveAbsolute(absolute.date, time)}
            />
          </span>
        )}

        {type === 'relative' && (
          <label className="field">
            <span>생성 후</span>
            <span className="inline">
              <input
                type="number"
                min={1}
                max={365}
                key={`${todo.id}-rel`}
                defaultValue={todo.deadlineRelativeDays ?? 3}
                onChange={(e) => {
                  const days = Number(e.target.value)
                  if (days > 0) patch({ deadline: { type: 'relative', relativeDays: days } })
                }}
              />
              일 이내
            </span>
          </label>
        )}

        {countdown && (
          <p className={`countdown level-${countdown.level}`}>
            {countdown.level === 'overdue' ? '지남 ' : '남음 '}
            {countdown.full}
          </p>
        )}

        <label className="field-block">
          <span>설명</span>
          <textarea
            rows={3}
            key={`${todo.id}-desc`}
            defaultValue={todo.description ?? ''}
            placeholder="자유롭게 적어두세요"
            onBlur={(e) => patch({ description: e.target.value.trim() || null })}
          />
        </label>

        <label className="field-block">
          <span>링크</span>
          <input
            type="url"
            key={`${todo.id}-url`}
            defaultValue={todo.url ?? ''}
            placeholder="https://"
            onBlur={(e) => patch({ url: e.target.value.trim() || null })}
          />
        </label>

        {todo.url && (
          // target=_blank는 메인의 setWindowOpenHandler가 잡아 기본 브라우저로 보낸다.
          <a className="detail-link" href={todo.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} strokeWidth={1.8} /> 링크 열기
          </a>
        )}
      </div>
    </div>
  )
}

/** `datetime-local`은 로컬 시각 문자열을 받는다. ISO를 그대로 넣으면 UTC라 어긋난다. */
/**
 * ISO 타임스탬프를 입력칸용 로컬 날짜/시각으로 가른다.
 * `toISOString().slice()`로 자르면 UTC라 한국에서 9시간 어긋난다 (코드 컨벤션).
 */
function splitLocal(iso: string | null): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: iso ? `${p(d.getHours())}:${p(d.getMinutes())}` : '23:50',
  }
}
