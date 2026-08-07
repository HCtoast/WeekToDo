import { randomUUID } from 'node:crypto'
import { resolveDeadline, type DeadlineSpec, type ResolvedDeadline } from '@shared/deadline'
import type { DateStr, TimeStr } from '@shared/types'
import type { AnchorRow, GoogleEventRow, LocalEventRow } from '@shared/types'
import { getDb } from '@main/db/client'

/**
 * 주간 뷰가 쓰는 읽기 쿼리 모음.
 * 쓰기(생성/이동/리사이즈)는 Phase 4에서 이 파일에 함께 붙인다.
 */

/** `IN (?, ?, ...)` 자리표시자. 날짜 배열은 최대 7개라 길이 걱정이 없다. */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

export function listLocalEvents(dates: DateStr[]): LocalEventRow[] {
  if (dates.length === 0) return []
  return getDb()
    .prepare(
      `SELECT * FROM local_events
       WHERE date IN (${placeholders(dates.length)})
       ORDER BY date, order_index`,
    )
    .all(...dates) as LocalEventRow[]
}

export function listGoogleEvents(dates: DateStr[]): GoogleEventRow[] {
  if (dates.length === 0) return []
  return getDb()
    .prepare(
      `SELECT * FROM google_event_cache
       WHERE date IN (${placeholders(dates.length)})
       ORDER BY date, start_time`,
    )
    .all(...dates) as GoogleEventRow[]
}

export interface TodoSlotWithTodo {
  id: string
  todo_id: string
  date: DateStr
  start_time: string
  end_time: string
  title: string
  category_id: string | null
  completed: number
}

export function listTodoSlots(dates: DateStr[]): TodoSlotWithTodo[] {
  if (dates.length === 0) return []
  return getDb()
    .prepare(
      `SELECT s.id, s.todo_id, s.date, s.start_time, s.end_time,
              t.title, t.category_id, t.completed
       FROM todo_time_slots s
       JOIN todos t ON t.id = s.todo_id
       WHERE s.date IN (${placeholders(dates.length)})
       ORDER BY s.date, s.start_time`,
    )
    .all(...dates) as TodoSlotWithTodo[]
}

/** 행이 있는 날만 돌아온다 — 없는 날은 요일 기본값이 앵커다. */
export function listAnchors(dates: DateStr[]): AnchorRow[] {
  if (dates.length === 0) return []
  return getDb()
    .prepare(`SELECT * FROM anchors WHERE date IN (${placeholders(dates.length)})`)
    .all(...dates) as AnchorRow[]
}

/**
 * 화면이 필요로 하는 TODO 전부 — 미배치(백로그) + 지금 보이는 날짜에 배치된 것.
 *
 * 배치된 것까지 함께 주는 이유: 그리드 블록에서 상세를 열려면 그 TODO의 설명·링크·마감이
 * 필요한데, 백로그만 주면 배치된 순간 화면에서 그 정보를 찾을 수 없다.
 * 완료된 지난 항목까지 다 보내지는 않으므로 양은 화면 크기에 비례한다.
 *
 * 정렬: 수동 정렬값이 있으면 항상 우선, 없으면 카테고리 우선순위.
 */
export function listTodosForView(dates: DateStr[]): {
  id: string
  title: string
  category_id: string | null
  completed: number
  deadline_computed: string | null
  deadline_type: 'absolute' | 'relative' | null
  deadline_relative_days: number | null
  backlog_order: number | null
  description: string | null
  url: string | null
  /** 1이면 어딘가에 시간대가 배치되어 있다 = 백로그가 아니다 */
  placed: number
}[] {
  const inDates = dates.length > 0 ? `s.date IN (${placeholders(dates.length)})` : '0'

  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.category_id, t.completed, t.deadline_computed, t.backlog_order,
              t.deadline_type, t.deadline_relative_days, t.description, t.url,
              (SELECT COUNT(*) FROM todo_time_slots x WHERE x.todo_id = t.id) > 0 AS placed
         FROM todos t
        WHERE NOT EXISTS (SELECT 1 FROM todo_time_slots s WHERE s.todo_id = t.id)
           OR EXISTS (SELECT 1 FROM todo_time_slots s WHERE s.todo_id = t.id AND ${inDates})
        ORDER BY t.completed,
                 CASE WHEN t.backlog_order IS NULL THEN 1 ELSE 0 END,
                 t.backlog_order,
                 COALESCE((SELECT priority FROM categories c WHERE c.id = t.category_id), 999),
                 t.created_at`,
    )
    .all(...dates) as never
}

export interface CompletedTodoRow {
  id: string
  title: string
  category_id: string | null
  completed_at: string
}

/**
 * 히스토리용 완료 목록.
 *
 * 논리적 날짜로 묶는 것은 호출부가 한다 — `completed_at`은 ISO 타임스탬프라
 * dayStartHour 기준 날짜를 SQL로 계산하려면 문자열 산술이 지저분해지고,
 * 새벽에 완료한 항목이 엉뚱한 날로 묶이기 쉽다.
 */
export function listCompletedTodos(limit: number): CompletedTodoRow[] {
  return getDb()
    .prepare(
      `SELECT id, title, category_id, completed_at
         FROM todos
        WHERE completed = 1
          AND completed_at IS NOT NULL
          AND include_in_history = 1
        ORDER BY completed_at DESC
        LIMIT ?`,
    )
    .all(limit) as CompletedTodoRow[]
}

// ── 쓰기 ──────────────────────────────────────────────────────────────────────

const now = (): string => new Date().toISOString()

/**
 * 컬럼별 UPDATE 문을 매번 손으로 쓰지 않기 위한 헬퍼.
 * 컬럼 이름은 호출부의 매핑 테이블에서만 오고 사용자 입력이 닿지 않으므로 문자열 조합이 안전하다.
 */
function patchRow(
  table: string,
  id: string,
  columns: Record<string, unknown>,
  touchUpdatedAt: boolean,
): void {
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return

  const assignments = entries.map(([c]) => `${c} = @${c}`)
  if (touchUpdatedAt) assignments.push('updated_at = @updated_at')

  getDb()
    .prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = @id`)
    .run({ ...Object.fromEntries(entries), id, updated_at: now() })
}

export function createLocalEvent(input: {
  date: DateStr
  title: string
  durationMinutes: number
  categoryId: string | null
}): void {
  const ts = now()
  // 새 항목은 그날 큐의 맨 뒤에 붙는다.
  const { next } = getDb()
    .prepare(
      `SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM local_events WHERE date = ?`,
    )
    .get(input.date) as { next: number }

  getDb()
    .prepare(
      `INSERT INTO local_events
         (id, date, title, duration_minutes, order_index, category_id, is_held, completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(randomUUID(), input.date, input.title, input.durationMinutes, next, input.categoryId, ts, ts)
}

export function updateLocalEvent(
  id: string,
  patch: {
    title?: string
    durationMinutes?: number
    categoryId?: string | null
    isHeld?: boolean
    completed?: boolean
  },
): void {
  patchRow(
    'local_events',
    id,
    {
      title: patch.title,
      duration_minutes: patch.durationMinutes,
      category_id: patch.categoryId,
      is_held: patch.isHeld === undefined ? undefined : patch.isHeld ? 1 : 0,
      completed: patch.completed === undefined ? undefined : patch.completed ? 1 : 0,
      // 완료를 풀면 완료 시각도 지운다 — 남아 있으면 히스토리에 유령 기록이 생긴다.
      completed_at:
        patch.completed === undefined ? undefined : patch.completed ? now() : null,
    },
    true,
  )
}

/** 순서 변경은 그날 큐 전체를 다시 매긴다 — 부분 갱신보다 어긋날 여지가 없다. */
export function reorderLocalEvents(date: DateStr, orderedIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare(
    `UPDATE local_events SET order_index = ?, updated_at = ? WHERE id = ? AND date = ?`,
  )
  const ts = now()
  db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, ts, id, date))
  })()
}

export function deleteLocalEvent(id: string): void {
  getDb().prepare('DELETE FROM local_events WHERE id = ?').run(id)
}

/** 요일 기본값을 덮어쓴다. 날짜당 1행이므로 upsert. */
export function setAnchor(date: DateStr, anchorTime: TimeStr, source: 'manual' | 'autostart'): void {
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO anchors (id, date, anchor_time, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         anchor_time = excluded.anchor_time,
         source = excluded.source,
         updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), date, anchorTime, source, ts, ts)
}

/** autostart 행은 그날 행이 하나도 없을 때만 만든다 (첫 실행만 반영). */
export function setAnchorIfAbsent(date: DateStr, anchorTime: TimeStr): boolean {
  const ts = now()
  const result = getDb()
    .prepare(
      `INSERT INTO anchors (id, date, anchor_time, source, created_at, updated_at)
       VALUES (?, ?, ?, 'autostart', ?, ?)
       ON CONFLICT(date) DO NOTHING`,
    )
    .run(randomUUID(), date, anchorTime, ts, ts)
  return result.changes > 0
}

export function clearAnchor(date: DateStr): void {
  getDb().prepare('DELETE FROM anchors WHERE date = ?').run(date)
}

export function createTodo(input: {
  title: string
  categoryId: string | null
  /** 이 카테고리로 만든 항목은 히스토리에서 기본 제외한다 */
  historyExcludedCategoryIds?: string[]
}): string {
  const id = randomUUID()
  const ts = now()
  const excluded =
    input.categoryId !== null && input.historyExcludedCategoryIds?.includes(input.categoryId)

  getDb()
    .prepare(
      `INSERT INTO todos (id, title, category_id, include_in_history, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.title, input.categoryId, excluded ? 0 : 1, ts, ts)
  return id
}

export function updateTodo(
  id: string,
  patch: {
    title?: string
    description?: string | null
    url?: string | null
    categoryId?: string | null
    completed?: boolean
    deadline?: DeadlineSpec
  },
): void {
  // relative 마감은 "생성 후 N일"이므로 생성 시각이 필요하다.
  let deadline: ResolvedDeadline | null = null
  if (patch.deadline !== undefined) {
    const row = getDb().prepare('SELECT created_at FROM todos WHERE id = ?').get(id) as
      | { created_at: string }
      | undefined
    if (row) deadline = resolveDeadline(patch.deadline, row.created_at)
  }

  patchRow(
    'todos',
    id,
    {
      title: patch.title,
      description: patch.description,
      url: patch.url,
      category_id: patch.categoryId,
      completed: patch.completed === undefined ? undefined : patch.completed ? 1 : 0,
      completed_at: patch.completed === undefined ? undefined : patch.completed ? now() : null,
      ...(deadline ?? {}),
    },
    true,
  )
}

export function deleteTodo(id: string): void {
  // 슬롯은 FK가 ON DELETE CASCADE라 함께 사라진다.
  getDb().prepare('DELETE FROM todos WHERE id = ?').run(id)
}

/** 한 번 손으로 정렬하면 그 뒤로는 카테고리 우선순위보다 이 값이 항상 이긴다. */
export function reorderBacklog(orderedIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE todos SET backlog_order = ?, updated_at = ? WHERE id = ?')
  const ts = now()
  db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, ts, id))
  })()
}

export function createTodoSlot(input: {
  todoId: string
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
}): void {
  getDb()
    .prepare(
      `INSERT INTO todo_time_slots (id, todo_id, date, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), input.todoId, input.date, input.startTime, input.endTime)
}

export function updateTodoSlot(
  id: string,
  patch: { date?: DateStr; startTime?: TimeStr; endTime?: TimeStr },
): void {
  patchRow(
    'todo_time_slots',
    id,
    { date: patch.date, start_time: patch.startTime, end_time: patch.endTime },
    false,
  )
}

/**
 * 구글 이벤트의 홀드 토글.
 *
 * `is_held`는 구글이 모르는 로컬 소유 컬럼이라 여기서만 바뀌고, 동기화는 이 값을 보존한다
 * (`replaceGoogleEvents`가 구글 필드만 덮어쓴다).
 */
export function setGoogleEventHeld(googleEventId: string, isHeld: boolean): void {
  getDb()
    .prepare('UPDATE google_event_cache SET is_held = ? WHERE google_event_id = ?')
    .run(isHeld ? 1 : 0, googleEventId)
}

/** 슬롯만 지우면 TODO는 미배치 백로그로 돌아간다. */
export function deleteTodoSlot(id: string): void {
  getDb().prepare('DELETE FROM todo_time_slots WHERE id = ?').run(id)
}

export interface GoogleEventInput {
  googleEventId: string
  calendarId: string
  title: string
  description: string | null
  location: string | null
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
  isRecurring: boolean
  recurrenceRule: string | null
  isAllDay: boolean
}

/**
 * 동기화 결과로 캐시를 갱신한다.
 *
 * **구글 필드만 덮어쓰고 `is_held` / `created_at_original`은 보존한다.** 이 둘은 로컬 소유라
 * 그냥 지웠다 다시 넣으면 홀드 상태와 원본 시각 백업이 5분마다 사라진다.
 *
 * 구글에서 지워진 일정은 캐시에서도 빠져야 하므로, 이번에 받은 id 목록에 없는
 * 같은 기간의 행을 지운다. 기간 밖(예전에 동기화해둔 먼 미래)은 건드리지 않는다.
 */
export function replaceGoogleEvents(rows: GoogleEventInput[], from: DateStr, to: DateStr): void {
  const db = getDb()

  const upsert = db.prepare(
    `INSERT INTO google_event_cache
       (google_event_id, calendar_id, title, description, location, date, start_time, end_time,
        is_recurring, recurrence_rule, is_all_day, last_synced_at)
     VALUES (@googleEventId, @calendarId, @title, @description, @location, @date, @startTime,
             @endTime, @isRecurring, @recurrenceRule, @isAllDay, @syncedAt)
     ON CONFLICT(google_event_id) DO UPDATE SET
       calendar_id = excluded.calendar_id,
       title = excluded.title,
       description = excluded.description,
       location = excluded.location,
       date = excluded.date,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       is_recurring = excluded.is_recurring,
       recurrence_rule = excluded.recurrence_rule,
       is_all_day = excluded.is_all_day,
       last_synced_at = excluded.last_synced_at`,
  )

  const syncedAt = now()

  db.transaction(() => {
    for (const row of rows) {
      upsert.run({
        ...row,
        isRecurring: row.isRecurring ? 1 : 0,
        isAllDay: row.isAllDay ? 1 : 0,
        syncedAt,
      })
    }

    // 이번 동기화에서 안 보인 것 = 구글에서 지워졌거나 옮겨진 것.
    db.prepare(
      `DELETE FROM google_event_cache
        WHERE date BETWEEN ? AND ? AND last_synced_at <> ?`,
    ).run(from, to, syncedAt)
  })()
}
