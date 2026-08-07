import { describe, expect, it } from 'vitest'
import { layoutDay } from '@shared/scheduler/layout'
import type { FixedBlock, LayoutInput, QueueItem } from '@shared/scheduler/types'

const DAY_START = 6

function item(id: string, durationMinutes: number, categoryId?: string): QueueItem {
  return { id, title: id, durationMinutes, categoryId }
}

function fixed(id: string, startTime: string, endTime: string, categoryId?: string): FixedBlock {
  return { id, title: id, startTime, endTime, categoryId }
}

function run(overrides: Partial<LayoutInput>) {
  return layoutDay({
    anchorTime: '19:00',
    dayStartHour: DAY_START,
    queue: [],
    googleEvents: [],
    todoSlots: [],
    ...overrides,
  })
}

/** 검증을 읽기 쉽게 — 'id 시작~종료' 문자열로 압축한다. */
function times(blocks: { id: string; startTime: string; endTime: string }[]): string[] {
  return blocks.map((b) => `${b.id} ${b.startTime}~${b.endTime}`)
}

describe('앵커 기준 누적 배치', () => {
  // 기획서의 기본 예시: 앵커 19:00, 밥 60분 → 19:00~20:00, 과제 120분 → 20:00~22:00
  it('앵커부터 소요시간을 누적해 시각을 만든다', () => {
    const { blocks, overflow } = run({
      queue: [item('밥', 60), item('과제', 120), item('게임', 60)],
    })

    expect(times(blocks)).toEqual(['밥 19:00~20:00', '과제 20:00~22:00', '게임 22:00~23:00'])
    expect(overflow).toEqual([])
  })

  it('앵커가 바뀌면 큐 전체가 통째로 따라 움직인다', () => {
    const queue = [item('밥', 60), item('과제', 120)]
    expect(times(run({ anchorTime: '21:00', queue }).blocks)).toEqual([
      '밥 21:00~22:00',
      '과제 22:00~00:00',
    ])
  })

  it('자정을 넘겨도 같은 논리적 하루 안에 있다', () => {
    expect(times(run({ anchorTime: '23:00', queue: [item('게임', 180)] }).blocks)).toEqual([
      '게임 23:00~02:00',
    ])
  })

  it('소요시간이 0 이하면 던진다', () => {
    expect(() => run({ queue: [item('밥', 0)] })).toThrow()
  })
})

describe('소요시간 변경 — 뒷 항목 당김/밀림', () => {
  // DB에서 바뀌는 것은 그 항목의 duration 하나뿐이고, 나머지는 전부 파생 계산이다.
  it('줄이면 뒤가 당겨진다', () => {
    const before = run({ queue: [item('A', 120), item('B', 60), item('C', 60)] })
    const after = run({ queue: [item('A', 60), item('B', 60), item('C', 60)] })

    expect(times(before.blocks)).toEqual(['A 19:00~21:00', 'B 21:00~22:00', 'C 22:00~23:00'])
    expect(times(after.blocks)).toEqual(['A 19:00~20:00', 'B 20:00~21:00', 'C 21:00~22:00'])
  })

  it('늘리면 뒤가 밀린다', () => {
    const after = run({ queue: [item('A', 180), item('B', 60)] })
    expect(times(after.blocks)).toEqual(['A 19:00~22:00', 'B 22:00~23:00'])
  })
})

describe('순서 변경', () => {
  it('order만 바꾸면 시각은 알아서 다시 계산된다', () => {
    expect(times(run({ queue: [item('A', 60), item('B', 120)] }).blocks)).toEqual([
      'A 19:00~20:00',
      'B 20:00~22:00',
    ])
    expect(times(run({ queue: [item('B', 120), item('A', 60)] }).blocks)).toEqual([
      'B 19:00~21:00',
      'A 21:00~22:00',
    ])
  })
})

describe('구글 이벤트 = 고정 장애물', () => {
  it('겹치면 구글 이벤트가 끝나는 시각까지 큐가 밀린다', () => {
    const { blocks } = run({
      queue: [item('밥', 60), item('과제', 120)],
      googleEvents: [fixed('수업', '19:30', '21:00')],
    })

    // 밥(19:00~20:00)이 수업과 겹치므로 21:00으로 밀리고, 뒤도 이어서 밀린다.
    expect(times(blocks.filter((b) => b.kind === 'local'))).toEqual([
      '밥 21:00~22:00',
      '과제 22:00~00:00',
    ])
  })

  it('겹치지 않으면 밀지 않는다', () => {
    const { blocks } = run({
      queue: [item('밥', 60)],
      googleEvents: [fixed('수업', '20:00', '21:00')],
    })
    expect(times(blocks.filter((b) => b.kind === 'local'))).toEqual(['밥 19:00~20:00'])
  })

  it('연달아 붙은 장애물을 한 번에 통과한다', () => {
    const { blocks } = run({
      queue: [item('밥', 60)],
      googleEvents: [fixed('수업1', '19:00', '20:00'), fixed('수업2', '20:00', '21:30')],
    })
    expect(times(blocks.filter((b) => b.kind === 'local'))).toEqual(['밥 21:30~22:30'])
  })

  it('장애물 사이의 빈틈에 들어갈 수 있으면 들어간다', () => {
    const { blocks } = run({
      queue: [item('밥', 30)],
      googleEvents: [fixed('수업1', '18:00', '19:00'), fixed('수업2', '19:30', '21:00')],
    })
    expect(times(blocks.filter((b) => b.kind === 'local'))).toEqual(['밥 19:00~19:30'])
  })

  it('구글 이벤트 자체는 절대 밀리지 않는다', () => {
    const { blocks } = run({
      queue: [item('밥', 120)],
      googleEvents: [fixed('수업', '19:30', '21:00')],
    })
    const google = blocks.find((b) => b.kind === 'google')!
    expect(`${google.startTime}~${google.endTime}`).toBe('19:30~21:00')
  })
})

describe('하루 경계 이월', () => {
  it('경계를 넘는 항목부터 overflow로 넘긴다', () => {
    const { blocks, overflow } = run({
      anchorTime: '03:00', // 하루 끝(06:00)까지 3시간 남았다
      queue: [item('A', 60), item('B', 60), item('C', 120)],
    })

    expect(times(blocks)).toEqual(['A 03:00~04:00', 'B 04:00~05:00'])
    expect(overflow.map((i) => i.id)).toEqual(['C'])
  })

  // 뒷 항목만 골라 남기면 사용자가 정한 순서가 뒤집힌다.
  it('한 항목이 넘어가면 그 뒤는 들어갈 자리가 있어도 전부 넘긴다', () => {
    const { blocks, overflow } = run({
      anchorTime: '04:00',
      queue: [item('A', 180), item('B', 30)],
    })

    expect(blocks).toHaveLength(0)
    expect(overflow.map((i) => i.id)).toEqual(['A', 'B'])
  })

  it('하루 끝에 정확히 맞으면 넘기지 않는다', () => {
    const { blocks, overflow } = run({ anchorTime: '05:00', queue: [item('A', 60)] })
    expect(times(blocks)).toEqual(['A 05:00~06:00'])
    expect(overflow).toEqual([])
  })
})

describe('TODO 슬롯 — 겹침 허용', () => {
  it('밀림 로직의 대상이 아니다', () => {
    const { blocks } = run({
      queue: [item('밥', 60)],
      todoSlots: [fixed('보고서', '19:00', '20:00')],
    })

    // 로컬 이벤트와 완전히 겹쳐도 서로 밀지 않는다.
    expect(times(blocks.filter((b) => b.kind === 'local'))).toEqual(['밥 19:00~20:00'])
    expect(times(blocks.filter((b) => b.kind === 'todo'))).toEqual(['보고서 19:00~20:00'])
  })

  it('TODO끼리도 겹칠 수 있다', () => {
    const { blocks } = run({
      todoSlots: [fixed('밥', '19:00', '20:00'), fixed('게임', '19:00', '20:00')],
    })
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.columnCount === 2)).toBe(true)
  })
})

describe('겹침 나란히 배치', () => {
  it('겹치지 않으면 폭을 나누지 않는다', () => {
    const { blocks } = run({
      googleEvents: [fixed('A', '10:00', '11:00'), fixed('B', '11:00', '12:00')],
    })
    expect(blocks.map((b) => [b.column, b.columnCount])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('구글끼리 겹치면 나란히 반쪽씩 놓는다', () => {
    const { blocks } = run({
      googleEvents: [fixed('A', '10:00', '12:00'), fixed('B', '11:00', '13:00')],
    })
    expect(blocks.map((b) => [b.id, b.column, b.columnCount])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
    ])
  })

  it('끝난 열은 재사용한다', () => {
    const { blocks } = run({
      googleEvents: [
        fixed('A', '10:00', '13:00'),
        fixed('B', '10:00', '11:00'),
        fixed('C', '11:00', '12:00'),
      ],
    })
    const byId = Object.fromEntries(blocks.map((b) => [b.id, b.column]))
    // 시작이 같은 A와 B 중 긴 A가 왼쪽 열, B가 끝난 1번 열을 C가 물려받는다.
    expect(byId).toEqual({ A: 0, B: 1, C: 1 })
    expect(blocks.every((b) => b.columnCount === 2)).toBe(true)
  })

  it('시작이 같으면 긴 쪽이 왼쪽 열에 온다', () => {
    const { blocks } = run({
      googleEvents: [fixed('짧은', '10:00', '10:30'), fixed('긴', '10:00', '12:00')],
    })
    expect(blocks.map((b) => [b.id, b.column])).toEqual([
      ['긴', 0],
      ['짧은', 1],
    ])
  })
})

describe('명도 교차용 runIndex', () => {
  it('같은 카테고리가 연속되면 번갈아 매긴다', () => {
    const { blocks } = run({
      queue: [item('게임1', 60, 'cat-leisure'), item('게임2', 60, 'cat-leisure')],
    })
    expect(blocks.map((b) => b.runIndex)).toEqual([0, 1])
  })

  it('카테고리가 바뀌면 처음으로 돌아간다', () => {
    const { blocks } = run({
      queue: [
        item('게임1', 60, 'cat-leisure'),
        item('게임2', 60, 'cat-leisure'),
        item('과제', 60, 'cat-assignment'),
        item('게임3', 60, 'cat-leisure'),
      ],
    })
    expect(blocks.map((b) => b.runIndex)).toEqual([0, 1, 0, 0])
  })

  it('카테고리가 없으면 항상 0이다', () => {
    const { blocks } = run({ queue: [item('A', 60), item('B', 60)] })
    expect(blocks.map((b) => b.runIndex)).toEqual([0, 0])
  })
})

describe('기획서 시나리오: 게임1을 1시간 줄이고 그 뒤에 게임4 넣기', () => {
  // AI든 드래그든 두 개의 독립 액션으로 분해되고, 결과 배치는 이 엔진이 계산한다.
  const anchorTime = '08:00'

  it('처음 상태', () => {
    const { blocks } = run({
      anchorTime,
      queue: [item('게임1', 120), item('게임2', 120), item('게임3', 120)],
    })
    expect(times(blocks)).toEqual([
      '게임1 08:00~10:00',
      '게임2 10:00~12:00',
      '게임3 12:00~14:00',
    ])
  })

  it('1단계 — 게임1을 1시간으로 줄이면 뒤가 당겨진다', () => {
    const { blocks } = run({
      anchorTime,
      queue: [item('게임1', 60), item('게임2', 120), item('게임3', 120)],
    })
    expect(times(blocks)).toEqual([
      '게임1 08:00~09:00',
      '게임2 09:00~11:00',
      '게임3 11:00~13:00',
    ])
  })

  it('2단계 — 게임4를 그 뒤에 끼우면 나머지가 다시 밀린다', () => {
    const { blocks } = run({
      anchorTime,
      queue: [item('게임1', 60), item('게임4', 60), item('게임2', 120), item('게임3', 120)],
    })
    // 기획서가 적은 최종 결과와 일치: 게임2 10~12, 게임3 12~14
    expect(times(blocks)).toEqual([
      '게임1 08:00~09:00',
      '게임4 09:00~10:00',
      '게임2 10:00~12:00',
      '게임3 12:00~14:00',
    ])
  })
})

describe('기획서 시나리오: 평소 일정 스타일', () => {
  it('7~8 밥 / 8~10 과제 / 10~11 게임1 / 11~12 게임2 / 12~1 웹서핑', () => {
    const { blocks } = run({
      anchorTime: '19:00',
      queue: [
        item('밥', 60),
        item('과제', 120, 'cat-assignment'),
        item('게임1', 60, 'cat-leisure'),
        item('게임2', 60, 'cat-leisure'),
        item('웹서핑', 60),
      ],
    })

    expect(times(blocks)).toEqual([
      '밥 19:00~20:00',
      '과제 20:00~22:00',
      '게임1 22:00~23:00',
      '게임2 23:00~00:00',
      '웹서핑 00:00~01:00',
    ])
    // 게임1 / 게임2는 명도를 갈라 경계를 보이게 한다.
    expect(blocks.map((b) => b.runIndex)).toEqual([0, 0, 0, 1, 0])
  })
})
