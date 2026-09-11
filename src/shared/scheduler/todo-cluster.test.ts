import { describe, expect, it } from 'vitest'
import { buildTodoClusters } from '@shared/scheduler/todo-cluster'
import type { BlockKind, PlacedBlock } from '@shared/scheduler/types'

/** 한 줄 = 18분. 화면에서 16px / 0.9(px per minute)로 나온 값과 같은 자리수다. */
const ROW = 18

function block(
  id: string,
  startOffset: number,
  endOffset: number,
  kind: BlockKind = 'todo',
  stackIndex = 0,
): PlacedBlock {
  return {
    kind,
    id,
    title: id,
    startOffset,
    endOffset,
    startTime: '00:00',
    endTime: '00:00',
    categoryId: null,
    meta: {},
    column: 0,
    columnCount: 1,
    stackIndex,
    runIndex: 0,
  }
}

/** layoutDay가 돌려주는 것과 같은 정렬 — buildTodoClusters의 전제다. */
function sorted(blocks: PlacedBlock[]): PlacedBlock[] {
  return [...blocks].sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset || a.id.localeCompare(b.id),
  )
}

describe('buildTodoClusters — 묶기', () => {
  it('겹치지 않으면 카드를 만들지 않는다', () => {
    const blocks = sorted([block('a', 0, 60), block('b', 60, 120)])
    const { clusters, clusteredIds } = buildTodoClusters(blocks, ROW)

    expect(clusters).toHaveLength(0)
    expect(clusteredIds.size).toBe(0)
  })

  it('끝과 시작이 맞닿는 것은 겹침이 아니다', () => {
    const { clusters } = buildTodoClusters(sorted([block('a', 0, 60), block('b', 60, 90)]), ROW)
    expect(clusters).toHaveLength(0)
  })

  it('부분적으로 겹치면 한 카드로 묶고 합집합 구간을 차지한다', () => {
    // 13:00~15:00 과 14:00~16:00 (사용자가 물어본 경우)
    const blocks = sorted([block('a', 420, 540), block('b', 480, 600)])
    const { clusters, clusteredIds } = buildTodoClusters(blocks, ROW)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.startOffset).toBe(420)
    expect(clusters[0]!.endOffset).toBe(600)
    expect(clusteredIds).toEqual(new Set(['a', 'b']))
  })

  it('완전히 안에 든 것도 자기 줄을 갖는다 — 예전에는 통째로 가려졌다', () => {
    const blocks = sorted([block('겉', 0, 120), block('안', 30, 60)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters[0]!.rows.map((r) => r.block.id)).toEqual(['겉', '안'])
    expect(clusters[0]!.hiddenCount).toBe(0)
  })

  it('겹침을 타고 이어진 것들은 한 묶음이다 (A-B, B-C가 겹치고 A-C는 안 겹쳐도)', () => {
    const blocks = sorted([block('a', 0, 60), block('b', 30, 120), block('c', 90, 150)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.startOffset).toBe(0)
    expect(clusters[0]!.endOffset).toBe(150)
    expect(clusters[0]!.rows).toHaveLength(3)
  })

  it('떨어진 겹침 무리는 각각 카드가 된다', () => {
    const blocks = sorted([
      block('a', 0, 60),
      block('b', 30, 90),
      block('c', 300, 360),
      block('d', 330, 390),
    ])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.rows.map((r) => r.block.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('TODO가 아닌 블록은 묶지 않는다 — 구글끼리의 겹침은 열 배정이 맡는다', () => {
    const blocks = sorted([block('g1', 0, 60, 'google'), block('g2', 30, 90, 'google')])
    const { clusters } = buildTodoClusters(blocks, ROW)
    expect(clusters).toHaveLength(0)
  })

  it('구글 이벤트는 TODO끼리의 묶음을 갈라놓지 않는다', () => {
    const blocks = sorted([block('a', 0, 120), block('g', 10, 20, 'google'), block('b', 60, 180)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.rows.map((r) => r.block.id)).toEqual(['a', 'b'])
  })
})

describe('buildTodoClusters — 줄 배치', () => {
  it('줄은 자기 시작 시각 높이에 놓인다', () => {
    const blocks = sorted([block('a', 420, 540), block('b', 480, 600)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    // 카드 시작이 420이므로 a는 0, b는 60분 아래
    expect(clusters[0]!.rows.map((r) => r.topMinutes)).toEqual([0, 60])
  })

  it('시작이 한 줄 높이보다 가까우면 최소로 밀어낸다', () => {
    // 세 개가 5분 간격 — 그대로 두면 줄이 서로 겹친다
    const blocks = sorted([block('a', 0, 120), block('b', 5, 120), block('c', 10, 120)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters[0]!.rows.map((r) => r.topMinutes)).toEqual([0, ROW, ROW * 2])
  })

  it('밀어낸 뒤에도 여유가 생기면 다시 자기 시작 시각으로 돌아간다', () => {
    const blocks = sorted([block('a', 0, 200), block('b', 5, 200), block('c', 100, 200)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    // a는 0, b는 겹쳐서 18로 밀리지만, c는 100이 이미 18+18보다 아래라 그대로 100
    expect(clusters[0]!.rows.map((r) => r.topMinutes)).toEqual([0, ROW, 100])
  })

  it('줄이 하나도 안 겹치면 아무것도 밀리지 않는다', () => {
    const blocks = sorted([block('a', 0, 300), block('b', 60, 300), block('c', 120, 300)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters[0]!.rows.map((r) => r.topMinutes)).toEqual([0, 60, 120])
  })
})

describe('buildTodoClusters — 넘치는 경우', () => {
  it('카드 높이를 넘는 줄은 접고 개수를 남긴다', () => {
    // 30분 구간에 네 개 → 한 줄(18분)씩 밀면 0, 18, 36, 54지만 카드는 30분뿐
    const blocks = sorted([
      block('a', 0, 30),
      block('b', 2, 30),
      block('c', 4, 30),
      block('d', 6, 30),
    ])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters[0]!.endOffset - clusters[0]!.startOffset).toBe(30)
    expect(clusters[0]!.rows.map((r) => r.block.id)).toEqual(['a'])
    expect(clusters[0]!.hiddenCount).toBe(3)
  })

  it('한 줄도 안 들어가는 카드라도 첫 줄은 보여준다', () => {
    const blocks = sorted([block('a', 0, 10), block('b', 1, 10)])
    const { clusters } = buildTodoClusters(blocks, ROW)

    expect(clusters[0]!.rows).toHaveLength(1)
    expect(clusters[0]!.hiddenCount).toBe(1)
  })

  it('전부 들어가면 hiddenCount가 0이다', () => {
    const blocks = sorted([block('a', 0, 300), block('b', 60, 300)])
    const { clusters } = buildTodoClusters(blocks, ROW)
    expect(clusters[0]!.hiddenCount).toBe(0)
  })
})

describe('buildTodoClusters — 카드 밀기', () => {
  it('구성원 중 하나라도 다른 블록 위에 얹혀 있으면 카드를 한 칸 민다', () => {
    const blocks = sorted([block('a', 0, 120, 'todo', 0), block('b', 60, 180, 'todo', 1)])
    const { clusters } = buildTodoClusters(blocks, ROW)
    expect(clusters[0]!.stackIndex).toBe(1)
  })

  it('아무것도 안 깔려 있으면 밀지 않는다', () => {
    const blocks = sorted([block('a', 0, 120), block('b', 60, 180)])
    const { clusters } = buildTodoClusters(blocks, ROW)
    expect(clusters[0]!.stackIndex).toBe(0)
  })
})

describe('buildTodoClusters — 키', () => {
  it('구성이 바뀌면 키도 바뀐다 — 드래그로 빠져나간 항목은 다른 카드다', () => {
    const two = buildTodoClusters(sorted([block('a', 0, 120), block('b', 60, 180)]), ROW)
    const three = buildTodoClusters(
      sorted([block('a', 0, 120), block('b', 60, 180), block('c', 100, 200)]),
      ROW,
    )

    expect(two.clusters[0]!.id).not.toBe(three.clusters[0]!.id)
  })
})
