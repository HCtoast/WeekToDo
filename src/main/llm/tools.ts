import { LLM_CONTEXT_FUTURE_DAYS, LLM_CONTEXT_PAST_DAYS } from '@shared/constants'
import type { DeadlineSpec } from '@shared/deadline'
import type { DateStr, TimeStr } from '@shared/types'
import { addDays, getLogicalDate, layoutDay, relativeDayLabel } from '@shared/scheduler'
import { applyMutation } from '@main/db/mutations'
import { loadScheduleData } from '@main/db/schedule-view'
import { listCategories } from '@main/db/repositories/categories'
import { getAllSettings } from '@main/db/repositories/settings'

/**
 * 채팅이 쓸 수 있는 도구.
 *
 * **삭제 도구는 일부러 넣지 않았다.** 되돌릴 수 없는 조작을 모델 판단에 맡기면
 * 오해 한 번에 사용자의 기록이 사라진다 (설계 원칙 6: 데이터는 삭제하지 않는다).
 * 대신 되돌릴 수 있는 것만 준다 — 완료 체크, 배치 해제(백로그로 되돌림), 시간 이동.
 * 실제 삭제는 사용자가 그리드에서 직접 한다.
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const KO_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export interface ToolDefinition {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const dateProp = { type: 'string', description: "'YYYY-MM-DD' 형식의 논리적 날짜" }
const timeProp = { type: 'string', description: "'HH:MM' 24시간 형식" }

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_schedule',
    description:
      '지정한 기간의 일정을 읽는다. 무엇을 바꾸기 전에 항상 먼저 불러서 실제 상태와 id를 확인할 것. ' +
      '범위를 주지 않으면 어제부터 2주치를 돌려준다.',
    input_schema: {
      type: 'object',
      properties: { startDate: dateProp, endDate: dateProp },
    },
  },
  {
    name: 'create_event',
    description:
      '로컬 일정을 그날 큐의 맨 뒤에 추가한다. 큐는 앵커 시각에서 시작해 소요시간만큼 차례로 이어지므로 ' +
      '시작 시각이 아니라 **소요시간**을 정한다. "저녁 8시에 뭘 하겠다"처럼 시각이 정해진 일은 ' +
      'create_todo로 시간대를 지정해 만드는 편이 맞다.',
    input_schema: {
      type: 'object',
      properties: {
        date: dateProp,
        title: { type: 'string' },
        durationMinutes: { type: 'integer', description: '소요시간(분). 양수' },
        categoryId: {
          type: 'string',
          description: '카테고리 id. 제목에 가장 맞는 것을 골라 반드시 넣는다 (없으면 "기타")',
        },
      },
      required: ['date', 'title', 'durationMinutes'],
    },
  },
  {
    name: 'update_event',
    description: '로컬 일정의 제목·소요시간·카테고리·홀드·완료를 고친다. 주는 항목만 바뀐다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        durationMinutes: { type: 'integer' },
        categoryId: { type: 'string' },
        isHeld: { type: 'boolean', description: '고정해 밀리지 않게 할지' },
        completed: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'reorder_events',
    description:
      '그날 로컬 큐의 순서를 통째로 다시 정한다. 그날 큐에 있는 id를 **빠짐없이** 원하는 순서로 준다.',
    input_schema: {
      type: 'object',
      properties: {
        date: dateProp,
        orderedIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['date', 'orderedIds'],
    },
  },
  {
    name: 'create_todo',
    description:
      'TODO를 만든다. date/startTime/endTime을 함께 주면 그 시간대에 바로 배치하고, ' +
      '주지 않으면 미배치 백로그에 쌓인다. TODO는 시간이 지나도 자동 완료되지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        categoryId: {
          type: 'string',
          description: '카테고리 id. 제목에 가장 맞는 것을 골라 반드시 넣는다 (없으면 "기타")',
        },
        date: dateProp,
        startTime: timeProp,
        endTime: timeProp,
      },
      required: ['title'],
    },
  },
  {
    name: 'update_todo',
    description:
      'TODO의 제목·설명·링크·카테고리·완료·마감을 고친다. 주는 항목만 바뀐다. ' +
      '완료 처리는 사용자가 명시적으로 요청했을 때만 한다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        url: { type: 'string' },
        categoryId: { type: 'string' },
        completed: { type: 'boolean' },
        deadlineAbsolute: {
          type: 'string',
          description: "절대 마감. 'YYYY-MM-DDTHH:MM' 로컬 시각. 빈 문자열이면 마감을 지운다",
        },
        deadlineRelativeDays: {
          type: 'integer',
          description: '생성일로부터 N일 뒤가 마감. deadlineAbsolute와 함께 주지 말 것',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'place_todo',
    description: '백로그에 있는 TODO를 특정 날짜·시간대에 배치한다.',
    input_schema: {
      type: 'object',
      properties: {
        todoId: { type: 'string' },
        date: dateProp,
        startTime: timeProp,
        endTime: timeProp,
      },
      required: ['todoId', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'move_todo_slot',
    description:
      '이미 배치된 TODO의 날짜나 시간대를 옮긴다. id는 get_schedule이 준 **슬롯 id**(slotId)다.',
    input_schema: {
      type: 'object',
      properties: {
        slotId: { type: 'string' },
        date: dateProp,
        startTime: timeProp,
        endTime: timeProp,
      },
      required: ['slotId'],
    },
  },
  {
    name: 'unplace_todo',
    description:
      '배치된 TODO를 그리드에서 떼어 백로그로 되돌린다. TODO 자체는 남는다 (삭제가 아니다).',
    input_schema: {
      type: 'object',
      properties: { slotId: { type: 'string' } },
      required: ['slotId'],
    },
  },
  {
    name: 'set_anchor',
    description:
      '그날 큐가 시작되는 기준 시각을 정한다. 15분 단위(00/15/30/45)만 쓴다. ' +
      '"오늘은 8시부터 시작" 같은 요청이 여기 해당한다.',
    input_schema: {
      type: 'object',
      properties: { date: dateProp, anchorTime: timeProp },
      required: ['date', 'anchorTime'],
    },
  },
  {
    name: 'clear_anchor',
    description: '그날의 앵커 지정을 지워 요일 기본값으로 되돌린다.',
    input_schema: {
      type: 'object',
      properties: { date: dateProp },
      required: ['date'],
    },
  },
]

/** 도구가 실제로 무엇을 했는지 — 화면에 그대로 보여준다 */
export interface ToolOutcome {
  /** 모델에게 돌려줄 결과 (JSON 직렬화된다) */
  result: unknown
  /** 사람이 읽을 한 줄. 읽기 전용 도구는 null */
  summary: string | null
}

/** 채팅이 들여다보는 기본 날짜 범위 */
export function defaultRange(): { startDate: DateStr; endDate: DateStr } {
  const today = getLogicalDate(new Date(), getAllSettings().dayStartHour)
  return {
    startDate: addDays(today, -LLM_CONTEXT_PAST_DAYS),
    endDate: addDays(today, LLM_CONTEXT_FUTURE_DAYS),
  }
}

function datesBetween(startDate: DateStr, endDate: DateStr): DateStr[] {
  const dates: DateStr[] = []
  // 상한을 둔다 — 모델이 1년치를 요청하면 응답이 컨텍스트를 통째로 먹는다.
  for (let d = startDate, i = 0; d <= endDate && i < 60; d = addDays(d, 1), i++) dates.push(d)
  return dates
}

/**
 * 모델에게 보여줄 일정 스냅샷.
 *
 * 저장값(순서 + 소요시간)만 주면 모델이 "저녁 8시"를 알 수 없으므로,
 * 화면과 **같은 `layoutDay`**를 거쳐 계산된 시각까지 함께 준다.
 * 계산 결과는 어디에도 저장하지 않는다 (설계 원칙 1).
 */
export function buildSnapshot(startDate: DateStr, endDate: DateStr): unknown {
  const settings = getAllSettings()
  const dates = datesBetween(startDate, endDate)
  const data = loadScheduleData(dates)
  const categories = listCategories()

  const days = data.days.map((day) => {
    const { blocks, overflow } = layoutDay({
      anchorTime: day.anchorTime,
      dayStartHour: settings.dayStartHour,
      queue: day.queue,
      googleEvents: day.googleEvents,
      todoSlots: day.todoSlots,
    })

    return {
      date: day.date,
      // "오늘/내일"을 여기서 확정해 준다 — 모델이 벽시계 날짜로 더하면 하루씩 밀린다.
      relative: relativeDayLabel(data.today, day.date),
      weekday: KO_WEEKDAY[new Date(`${day.date}T12:00:00`).getDay()],
      anchorTime: day.anchorTime,
      anchorIsOverride: day.anchorIsOverride,
      allDayEvents: day.allDayEvents.map((e) => e.title),
      blocks: blocks.map((b) => ({
        kind: b.kind,
        // 로컬 이벤트는 이벤트 id, TODO는 슬롯 id, 구글은 구글 이벤트 id다.
        id: b.id,
        ...(b.kind === 'todo' ? { todoId: b.meta.todoId } : {}),
        title: b.title,
        start: b.startTime,
        end: b.endTime,
        categoryId: b.categoryId,
        ...(b.meta.isHeld ? { held: true } : {}),
        ...(b.meta.completed ? { completed: true } : {}),
        ...(b.kind === 'google' ? { readonly: true } : {}),
      })),
      // 하루 경계를 넘겨 배치되지 못한 것들. 다음 날로 이월된다.
      overflow: overflow.map((q) => q.title),
    }
  })

  return {
    today: data.today,
    now: formatLocal(new Date()),
    dayStartHour: settings.dayStartHour,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      completable: c.completable === 1,
    })),
    days,
    backlog: data.backlogIds.map((id) => {
      const t = data.todos.find((x) => x.id === id)
      return {
        id,
        title: t?.title,
        categoryId: t?.categoryId ?? null,
        deadline: t?.deadline ?? null,
        completed: t?.completed ?? false,
      }
    }),
  }
}

function formatLocal(d: Date): string {
  // toISOString은 UTC라 잘라 쓰면 9시간 어긋난다 (코드 컨벤션).
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 인자 검증 ────────────────────────────────────────────────────────────────
// 모델이 만든 값은 사용자 입력과 같은 급으로 의심한다. 형식이 어긋나면 던지고,
// 그 메시지는 도구 결과로 모델에게 돌아가 스스로 고쳐 다시 부르게 한다.

type Args = Record<string, unknown>

function str(args: Args, key: string, required: true): string
function str(args: Args, key: string, required?: false): string | undefined
function str(args: Args, key: string, required = false): string | undefined {
  const v = args[key]
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`${key}가 필요합니다.`)
    return undefined
  }
  if (typeof v !== 'string') throw new Error(`${key}는 문자열이어야 합니다.`)
  return v
}

function date(args: Args, key: string, required = false): DateStr | undefined {
  const v = required ? str(args, key, true) : str(args, key)
  if (v === undefined) return undefined
  if (!DATE_RE.test(v)) throw new Error(`${key}는 'YYYY-MM-DD' 형식이어야 합니다: ${v}`)
  return v
}

function time(args: Args, key: string, required = false): TimeStr | undefined {
  const v = required ? str(args, key, true) : str(args, key)
  if (v === undefined) return undefined
  if (!TIME_RE.test(v)) throw new Error(`${key}는 'HH:MM' 형식이어야 합니다: ${v}`)
  return v
}

function bool(args: Args, key: string): boolean | undefined {
  const v = args[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new Error(`${key}는 true/false여야 합니다.`)
  return v
}

function int(args: Args, key: string, min: number): number | undefined {
  const v = args[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    throw new Error(`${key}는 ${min} 이상의 정수여야 합니다: ${String(v)}`)
  }
  return v
}

/** update_todo의 두 마감 표현을 하나의 DeadlineSpec으로 모은다 */
function deadlineOf(args: Args): DeadlineSpec | undefined {
  const absolute = args.deadlineAbsolute
  const relative = args.deadlineRelativeDays

  if (absolute !== undefined && absolute !== null) {
    if (typeof absolute !== 'string') throw new Error('deadlineAbsolute는 문자열이어야 합니다.')
    if (absolute === '') return { type: null }
    const parsed = new Date(absolute)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`deadlineAbsolute를 시각으로 읽을 수 없습니다: ${absolute}`)
    }
    return { type: 'absolute', absolute: parsed.toISOString() }
  }

  const days = int(args, 'deadlineRelativeDays', 0)
  if (days !== undefined) return { type: 'relative', relativeDays: days }
  if (relative === null) return { type: null }
  return undefined
}

/** 존재 확인용 — 없는 id로 조작하면 조용히 아무 일도 안 일어나므로 미리 막는다 */
function findBlock(id: string): { kind: string; title: string; date: DateStr } | null {
  const { startDate, endDate } = defaultRange()
  const data = loadScheduleData(datesBetween(startDate, endDate))

  for (const day of data.days) {
    const local = day.queue.find((q) => q.id === id)
    if (local) return { kind: 'local', title: local.title, date: day.date }
    const slot = day.todoSlots.find((s) => s.id === id)
    if (slot) return { kind: 'todoSlot', title: slot.title, date: day.date }
  }
  return null
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

export function runTool(name: string, rawArgs: unknown): ToolOutcome {
  const args = (rawArgs ?? {}) as Args

  switch (name) {
    case 'get_schedule': {
      const fallback = defaultRange()
      const startDate = date(args, 'startDate') ?? fallback.startDate
      const endDate = date(args, 'endDate') ?? fallback.endDate
      if (endDate < startDate) throw new Error('endDate가 startDate보다 앞섭니다.')
      return { result: buildSnapshot(startDate, endDate), summary: null }
    }

    case 'create_event': {
      const d = date(args, 'date', true)!
      const title = str(args, 'title', true)
      const durationMinutes = int(args, 'durationMinutes', 1)
      if (durationMinutes === undefined) throw new Error('durationMinutes가 필요합니다.')

      applyMutation({
        type: 'localEvent.create',
        date: d,
        title,
        durationMinutes,
        categoryId: str(args, 'categoryId') ?? null,
      })
      return {
        result: { ok: true },
        summary: `${d} 일정 추가 — ${title} (${durationMinutes}분)`,
      }
    }

    case 'update_event': {
      const id = str(args, 'id', true)
      const found = findBlock(id)
      if (!found || found.kind !== 'local') throw new Error(`로컬 일정을 찾을 수 없습니다: ${id}`)

      applyMutation({
        type: 'localEvent.update',
        id,
        patch: {
          title: str(args, 'title'),
          durationMinutes: int(args, 'durationMinutes', 1),
          categoryId: str(args, 'categoryId'),
          isHeld: bool(args, 'isHeld'),
          completed: bool(args, 'completed'),
        },
      })
      return { result: { ok: true }, summary: `일정 수정 — ${found.title}` }
    }

    case 'reorder_events': {
      const d = date(args, 'date', true)!
      const ids = args.orderedIds
      if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
        throw new Error('orderedIds는 문자열 배열이어야 합니다.')
      }
      applyMutation({ type: 'localEvent.reorder', date: d, orderedIds: ids as string[] })
      return { result: { ok: true }, summary: `${d} 큐 순서 변경 (${ids.length}개)` }
    }

    case 'create_todo': {
      const title = str(args, 'title', true)
      const categoryId = str(args, 'categoryId') ?? null
      const d = date(args, 'date')
      const startTime = time(args, 'startTime')
      const endTime = time(args, 'endTime')

      if (d && startTime && endTime) {
        if (endTime <= startTime) throw new Error('endTime이 startTime보다 뒤여야 합니다.')
        applyMutation({ type: 'todo.createAt', title, date: d, startTime, endTime, categoryId })
        return {
          result: { ok: true },
          summary: `TODO 추가 — ${title} (${d} ${startTime}~${endTime})`,
        }
      }
      if (d || startTime || endTime) {
        throw new Error('시간대에 배치하려면 date, startTime, endTime을 모두 주세요.')
      }

      applyMutation({ type: 'todo.create', title, categoryId })
      return { result: { ok: true }, summary: `TODO 추가 — ${title} (백로그)` }
    }

    case 'update_todo': {
      const id = str(args, 'id', true)
      applyMutation({
        type: 'todo.update',
        id,
        patch: {
          title: str(args, 'title'),
          description: str(args, 'description'),
          url: str(args, 'url'),
          categoryId: str(args, 'categoryId'),
          completed: bool(args, 'completed'),
          deadline: deadlineOf(args),
        },
      })
      const done = bool(args, 'completed')
      return {
        result: { ok: true },
        summary: `TODO 수정${done === true ? ' — 완료 처리' : done === false ? ' — 완료 해제' : ''}`,
      }
    }

    case 'place_todo': {
      const todoId = str(args, 'todoId', true)
      const d = date(args, 'date', true)!
      const startTime = time(args, 'startTime', true)!
      const endTime = time(args, 'endTime', true)!
      if (endTime <= startTime) throw new Error('endTime이 startTime보다 뒤여야 합니다.')

      applyMutation({ type: 'todoSlot.create', todoId, date: d, startTime, endTime })
      return { result: { ok: true }, summary: `TODO 배치 — ${d} ${startTime}~${endTime}` }
    }

    case 'move_todo_slot': {
      const slotId = str(args, 'slotId', true)
      const found = findBlock(slotId)
      if (!found || found.kind !== 'todoSlot') {
        throw new Error(`배치된 TODO 슬롯을 찾을 수 없습니다: ${slotId}`)
      }
      const startTime = time(args, 'startTime')
      const endTime = time(args, 'endTime')
      if (startTime && endTime && endTime <= startTime) {
        throw new Error('endTime이 startTime보다 뒤여야 합니다.')
      }

      applyMutation({
        type: 'todoSlot.update',
        id: slotId,
        patch: { date: date(args, 'date'), startTime, endTime },
      })
      return { result: { ok: true }, summary: `TODO 이동 — ${found.title}` }
    }

    case 'unplace_todo': {
      const slotId = str(args, 'slotId', true)
      const found = findBlock(slotId)
      if (!found || found.kind !== 'todoSlot') {
        throw new Error(`배치된 TODO 슬롯을 찾을 수 없습니다: ${slotId}`)
      }
      applyMutation({ type: 'todoSlot.delete', id: slotId })
      return { result: { ok: true }, summary: `TODO를 백로그로 되돌림 — ${found.title}` }
    }

    case 'set_anchor': {
      const d = date(args, 'date', true)!
      const anchorTime = time(args, 'anchorTime', true)!
      if (!['00', '15', '30', '45'].includes(anchorTime.slice(3))) {
        throw new Error(`앵커는 15분 단위여야 합니다 (00/15/30/45): ${anchorTime}`)
      }
      applyMutation({ type: 'anchor.set', date: d, anchorTime })
      return { result: { ok: true }, summary: `${d} 앵커 → ${anchorTime}` }
    }

    case 'clear_anchor': {
      const d = date(args, 'date', true)!
      applyMutation({ type: 'anchor.clear', date: d })
      return { result: { ok: true }, summary: `${d} 앵커를 요일 기본값으로 되돌림` }
    }

    default:
      throw new Error(`알 수 없는 도구입니다: ${name}`)
  }
}
