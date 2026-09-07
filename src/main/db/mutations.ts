import type { Mutation } from '@shared/ipc-contract'
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
      return schedule.setAnchor(m.date, m.anchorTime, 'manual')
    case 'anchor.clear':
      return schedule.clearAnchor(m.date)
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
      return schedule.updateTodoSlot(m.id, m.patch)
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
