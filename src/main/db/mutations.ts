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
export function applyMutation(m: Mutation): void {
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
