import { randomUUID } from 'node:crypto'
import type { DateStr } from '@shared/types'
import { addDays } from '@shared/scheduler'
import { getDb } from '@main/db/client'

/**
 * 개발용 샘플 데이터.
 * 아직 생성 UI가 없는 단계에서 그리드 렌더링과 밀림 로직을 눈으로 확인하기 위한 것이며,
 * 실제 입력 UI가 붙는 Phase 4에서 삭제한다.
 */
export function seedSampleDay(today: DateStr): void {
  const db = getDb()
  const now = new Date().toISOString()
  const tomorrow = addDays(today, 1)

  const insertLocal = db.prepare(
    `INSERT INTO local_events
       (id, date, title, duration_minutes, order_index, category_id, is_held, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  )
  const insertTodo = db.prepare(
    `INSERT INTO todos (id, title, category_id, deadline_computed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertSlot = db.prepare(
    `INSERT INTO todo_time_slots (id, todo_id, date, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
  )
  const insertGoogle = db.prepare(
    `INSERT INTO google_event_cache
       (google_event_id, calendar_id, title, date, start_time, end_time, last_synced_at)
     VALUES (?, 'demo', ?, ?, ?, ?, ?)`,
  )

  db.transaction(() => {
    // 기존 샘플을 지우고 다시 넣는다 (버튼을 여러 번 눌러도 쌓이지 않게).
    // anchors도 함께 비운다 — 앵커 override가 남아 있으면 큐 시작 시각이 달라져
    // 같은 시드인데도 매번 다른 배치(심하면 하루 경계를 넘어 이월)가 나온다.
    db.exec(`DELETE FROM local_events;
             DELETE FROM todo_time_slots;
             DELETE FROM todos;
             DELETE FROM anchors;
             DELETE FROM google_event_cache WHERE calendar_id = 'demo';`)

    // 기획서의 평소 스타일: 밥 / 과제 / 게임1 / 게임2 / 웹서핑
    const queue: [string, number, string | null][] = [
      ['밥', 60, 'cat-daily'],
      ['과제', 120, 'cat-assignment'],
      ['게임1', 60, 'cat-leisure'],
      ['게임2', 60, 'cat-leisure'],
      ['웹서핑', 60, null],
    ]
    queue.forEach(([title, duration, category], i) => {
      insertLocal.run(randomUUID(), today, title, duration, i, category, now, now)
    })

    // 내일은 구글 이벤트와 부딪히게 두어 밀림을 눈으로 본다.
    insertLocal.run(randomUUID(), tomorrow, '밥', 60, 0, 'cat-daily', now, now)
    insertLocal.run(randomUUID(), tomorrow, '캡스톤 작업', 120, 1, 'cat-dev', now, now)
    insertGoogle.run(randomUUID(), '기계학습 스터디', tomorrow, '19:30', '21:00', now)

    // 시간대가 배치된 TODO (겹침 허용 확인용) + 미배치 백로그 TODO
    const placed = randomUUID()
    insertTodo.run(placed, '보고서 초안', 'cat-assignment', null, now, now)
    insertSlot.run(randomUUID(), placed, today, '20:00', '21:30')

    for (const [title, category] of [
      ['향과학 정리', 'cat-assignment'],
      ['키보드 알아보기', 'cat-shopping'],
      ['영화 보기', 'cat-leisure'],
    ] as const) {
      insertTodo.run(randomUUID(), title, category, null, now, now)
    }
  })()
}
