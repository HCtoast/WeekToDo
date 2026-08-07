import { describe, expect, it } from 'vitest'
import { planQueueRollover, planSlotRollover, type DayQueue } from '@shared/scheduler/rollover'

const DAY_START = 6

function slot(id: string, date: string, startTime: string, endTime: string) {
  return { id, date, startTime, endTime }
}

function item(id: string, durationMinutes: number) {
  return { id, title: id, durationMinutes }
}

describe('planSlotRollover — 미완료 TODO를 오늘 앵커에 붙인다', () => {
  it('소요시간을 유지한 채 앵커에서 시작한다', () => {
    const moves = planSlotRollover({
      today: '2026-08-05',
      todayAnchor: '19:00',
      dayStartHour: DAY_START,
      pending: [slot('a', '2026-08-04', '14:00', '15:30')],
    })

    expect(moves).toEqual([
      { id: 'a', date: '2026-08-05', startTime: '19:00', endTime: '20:30' },
    ])
  })

  // 전부 앵커에 겹쳐두면 폭이 1/N로 쪼개져 읽을 수 없다.
  it('여러 개면 앵커부터 순차로 이어 붙인다', () => {
    const moves = planSlotRollover({
      today: '2026-08-05',
      todayAnchor: '19:00',
      dayStartHour: DAY_START,
      pending: [
        slot('a', '2026-08-04', '10:00', '11:00'),
        slot('b', '2026-08-04', '14:00', '14:30'),
      ],
    })

    expect(moves.map((m) => `${m.id} ${m.startTime}~${m.endTime}`)).toEqual([
      'a 19:00~20:00',
      'b 20:00~20:30',
    ])
  })

  it('오래 미룬 것이 먼저 온다', () => {
    const moves = planSlotRollover({
      today: '2026-08-05',
      todayAnchor: '19:00',
      dayStartHour: DAY_START,
      pending: [
        slot('어제', '2026-08-04', '10:00', '11:00'),
        slot('그제', '2026-08-03', '20:00', '21:00'),
      ],
    })

    expect(moves.map((m) => m.id)).toEqual(['그제', '어제'])
  })

  it('자정을 넘는 슬롯도 길이를 유지한다', () => {
    const moves = planSlotRollover({
      today: '2026-08-05',
      todayAnchor: '19:00',
      dayStartHour: DAY_START,
      pending: [slot('a', '2026-08-04', '23:30', '00:30')],
    })

    expect(moves[0]).toMatchObject({ startTime: '19:00', endTime: '20:00' })
  })

  // 하루를 넘겨 밀면 다음 논리적 날짜로 감겨 "오늘 이월분"이라는 의미가 깨진다.
  it('하루 끝을 넘길 만큼 쌓이면 더 밀지 않고 끝에 겹쳐 쌓는다', () => {
    const moves = planSlotRollover({
      today: '2026-08-05',
      todayAnchor: '04:00', // 하루 끝(06:00)까지 2시간
      dayStartHour: DAY_START,
      pending: [
        slot('a', '2026-08-04', '10:00', '11:30'), // 90분
        slot('b', '2026-08-04', '12:00', '13:30'), // 90분
      ],
    })

    expect(moves.map((m) => `${m.id} ${m.startTime}~${m.endTime}`)).toEqual([
      'a 04:00~05:30',
      'b 04:30~06:00', // 하루 끝에 맞춰 멈춘다
    ])
  })

  it('이월할 게 없으면 빈 배열', () => {
    expect(
      planSlotRollover({
        today: '2026-08-05',
        todayAnchor: '19:00',
        dayStartHour: DAY_START,
        pending: [],
      }),
    ).toEqual([])
  })
})

describe('planQueueRollover — 하루 경계 초과분을 다음 날로', () => {
  function day(date: string, anchorTime: string, queue: ReturnType<typeof item>[]): DayQueue {
    return { date, anchorTime, queue, googleEvents: [] }
  }

  it('넘치지 않으면 아무것도 안 옮긴다', () => {
    const plan = planQueueRollover(
      [day('2026-08-04', '19:00', [item('A', 60)]), day('2026-08-05', '19:00', [])],
      DAY_START,
    )
    expect(plan.moves).toEqual([])
    expect(plan.orders).toEqual([])
  })

  it('초과분만 다음 날 맨 앞으로 간다', () => {
    const plan = planQueueRollover(
      [
        // 앵커 04:00 → 하루 끝(06:00)까지 2시간뿐
        day('2026-08-04', '04:00', [item('A', 60), item('B', 60), item('C', 60)]),
        day('2026-08-05', '19:00', [item('오늘것', 30)]),
      ],
      DAY_START,
    )

    expect(plan.moves).toEqual([{ id: 'C', date: '2026-08-05' }])
    expect(plan.orders).toEqual([
      { date: '2026-08-04', orderedIds: ['A', 'B'] },
      // 못 끝낸 일이 먼저 눈에 띄도록 맨 앞에 붙는다
      { date: '2026-08-05', orderedIds: ['C', '오늘것'] },
    ])
  })

  it('며칠 밀려도 연쇄해서 오늘까지 온다', () => {
    const plan = planQueueRollover(
      [
        day('2026-08-03', '05:00', [item('A', 60), item('B', 60)]), // B가 넘침
        day('2026-08-04', '05:00', [item('C', 60)]), // B가 앞에 붙어 C가 넘침
        day('2026-08-05', '19:00', []),
      ],
      DAY_START,
    )

    expect(plan.moves).toEqual([
      { id: 'B', date: '2026-08-04' },
      { id: 'C', date: '2026-08-05' },
    ])
    expect(plan.orders).toEqual([
      { date: '2026-08-03', orderedIds: ['A'] },
      { date: '2026-08-04', orderedIds: ['B'] },
      { date: '2026-08-05', orderedIds: ['C'] },
    ])
  })

  // 오늘은 아직 안 끝났다. 앵커를 미루거나 항목을 줄이면 다시 들어올 수 있다.
  it('오늘의 초과분은 옮기지 않는다', () => {
    const plan = planQueueRollover(
      [
        day('2026-08-04', '19:00', [item('어제', 30)]),
        day('2026-08-05', '04:00', [item('A', 60), item('B', 120)]),
      ],
      DAY_START,
    )
    expect(plan.moves).toEqual([])
  })

  it('구글 이벤트에 밀려 넘치는 것도 이월된다', () => {
    const plan = planQueueRollover(
      [
        {
          date: '2026-08-04',
          anchorTime: '03:00',
          queue: [item('A', 120)],
          // 03:00~05:00을 막으면 A는 05:00~07:00이 되어 하루 끝(06:00)을 넘는다
          googleEvents: [{ id: 'g', title: '수업', startTime: '03:00', endTime: '05:00' }],
        },
        { date: '2026-08-05', anchorTime: '19:00', queue: [], googleEvents: [] },
      ],
      DAY_START,
    )

    expect(plan.moves).toEqual([{ id: 'A', date: '2026-08-05' }])
  })
})
