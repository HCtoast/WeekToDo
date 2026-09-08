import type { Mutation } from '@shared/ipc-contract'
import type { DateStr } from '@shared/types'
import { planAnchorRebind, resolveAnchor } from '@shared/scheduler'
import * as schedule from '@main/db/repositories/schedule'
import { getAllSettings } from '@main/db/repositories/settings'

/**
 * 쓰기 요청 하나를 실제 DB 조작으로 옮긴다.
 *
 * IPC 핸들러 안에 두지 않고 따로 뺀 이유: 채팅(LLM) 도구도 같은 동작을 해야 하는데,
 * 로직이 핸들러 안에 있으면 두 벌이 되어 한쪽만 고치는 사고가 난다.
 * 여기가 쓰기의 유일한 입구다.
 */
/**
 * 쓰기를 가로채는 함수. `null`이면 평소대로 DB에 쓴다.
 *
 * 자연어 명령 하네스(`--llm-try`)의 dry-run 전용이다. 모델이 **어떤 도구를 어떤 인자로**
 * 부르는지만 보고 싶을 때, 실제 일정을 건드리지 않고 기록만 남기기 위한 것.
 * 개발 경로에서만 켜지며 설치본에서는 아무도 부르지 않는다.
 */
let interceptor: ((m: Mutation) => void) | null = null

export function setMutationInterceptor(fn: ((m: Mutation) => void) | null): void {
  interceptor = fn
}

export function applyMutation(m: Mutation): void {
  // 빌드 시점 상수라 설치본에서는 이 분기 자체가 사라진다 —
  // 쓰기의 유일한 입구에 개발용 훅이 남아 있으면 안 된다.
  if (import.meta.env.DEV && interceptor) return interceptor(m)

  switch (m.type) {
    case 'localEvent.create':
      return schedule.createLocalEvent(m)
    case 'localEvent.update':
      return schedule.updateLocalEvent(m.id, m.patch)
    case 'localEvent.reorder':
      return schedule.reorderLocalEvents(m.date, m.orderedIds)
    case 'localEvent.delete':
      return schedule.deleteLocalEvent(m.id)
    case 'anchor.set':
      schedule.setAnchor(m.date, m.anchorTime, 'manual')
      return rebindAnchoredSlots(m.date)
    case 'anchor.clear':
      schedule.clearAnchor(m.date)
      // 지우면 요일 기본값으로 돌아간다 — 그것도 앵커가 바뀐 것이므로 함께 다시 붙인다.
      return rebindAnchoredSlots(m.date)
    case 'todo.create':
      schedule.createTodo({
        ...m,
        historyExcludedCategoryIds: getAllSettings().historyExcludedCategoryIds,
      })
      return
    case 'todo.createAt': {
      const todoId = schedule.createTodo({
        title: m.title,
        categoryId: m.categoryId ?? null,
        historyExcludedCategoryIds: getAllSettings().historyExcludedCategoryIds,
      })
      schedule.createTodoSlot({
        todoId,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
      })
      return
    }
    case 'todo.update':
      return schedule.updateTodo(m.id, m.patch)
    case 'todo.delete':
      return schedule.deleteTodo(m.id)
    case 'todo.reorderBacklog':
      return schedule.reorderBacklog(m.orderedIds)
    case 'todoSlot.create':
      return schedule.createTodoSlot(m)
    case 'todoSlot.update':
      /*
       * 사용자가 직접 옮기면 **앵커와의 연결을 끊는다.**
       *
       * 한 번 손으로 정한 자리는 그 사람의 결정이다. 그걸 계속 앵커에 묶어두면
       * 나중에 앵커를 옮겼을 때 애써 맞춰둔 시각이 저절로 사라진다.
       * (이 경로는 드래그·상세 편집·자연어 명령이 모두 지나간다)
       */
      return schedule.updateTodoSlot(m.id, { ...m.patch, anchorBound: false })
    case 'todoSlot.delete':
      return schedule.deleteTodoSlot(m.id)
    case 'googleEvent.setHeld':
      return schedule.setGoogleEventHeld(m.id, m.isHeld)
    case 'googleEvent.update':
    case 'googleEvent.create':
    case 'googleEvent.delete':
      // 구글 쓰기는 네트워크라 IPC 핸들러가 먼저 가로챈다. 여기까지 오면 배선이 틀린 것.
      throw new Error('구글 이벤트 쓰기는 로컬 DB 입구에서 처리하지 않습니다.')
  }
}

/**
 * 그날의 앵커가 바뀌었으니 **묶인 슬롯들을 새 앵커에 다시 붙인다.**
 *
 * 이월로 생긴 슬롯은 앵커에서 파생된 값이라 앵커를 따라가야 한다. 예전에는 이월 시점의
 * 앵커를 절대 시각으로 굳혀버려서, "오늘은 두 시간 늦게 시작"이라고 미뤄도 큐만 밀리고
 * 이월분은 옛 자리에 남았다.
 *
 * 사용자가 직접 옮긴 슬롯은 `anchor_bound`가 0이라 여기서 걸러진다.
 */
function rebindAnchoredSlots(date: DateStr): void {
  const settings = getAllSettings()
  const slots = schedule.listSlotsForRebind(date)
  if (!slots.some((s) => s.anchorBound)) return

  // 행이 없으면 요일 기본값이 앵커다 (설계 원칙 1-1: 앵커 없는 날은 없다).
  const anchorTime = resolveAnchor(
    date,
    schedule.listAnchors([date])[0],
    settings.weekdayAnchorTimes,
  )

  for (const move of planAnchorRebind({
    date,
    anchorTime,
    dayStartHour: settings.dayStartHour,
    slots,
  })) {
    // anchorBound는 그대로 둔다 — 앵커를 또 옮기면 다시 따라와야 한다.
    schedule.updateTodoSlot(move.id, {
      date: move.date,
      startTime: move.startTime,
      endTime: move.endTime,
    })
  }
}
