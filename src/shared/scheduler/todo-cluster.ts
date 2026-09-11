import type { PlacedBlock } from '@shared/scheduler/types'

/**
 * 겹친 TODO 슬롯을 **묶음 카드** 하나로 모은다.
 *
 * 예전에는 겹친 TODO를 조금씩 오른쪽으로 밀어 계단처럼 쌓았다. 그런데 뒤 블록이 앞 블록
 * **안에** 들어앉는 구조라(오른쪽으로 밀면서 폭이 같이 줄어 오른쪽 끝이 맞춰진다)
 * 앞 블록의 시각 글자가 테두리에 베이고, 남의 구간에 완전히 포함된 TODO는 실오라기만
 * 남아 아예 읽을 수 없었다.
 *
 * 그래서 겹치면 폭을 나누지도, 겹쳐 쌓지도 않는다. 겹친 것들을 담는 상자를 하나 두고
 * 그 안에서 **한 줄에 하나씩** 그린다. 줄은 서로 절대 겹치지 않으므로 가려지는 것도
 * 잘리는 것도 없다.
 *
 * 폭을 나누지 않는 이유는 그대로다 — 110px 열을 3분할하면 제목이 "겹침A.."로 줄어
 * 무엇인지 못 읽는다.
 */
export interface TodoClusterRow {
  block: PlacedBlock
  /**
   * 카드 위쪽에서 이 줄까지의 거리(분).
   *
   * 픽셀이 아니라 분이다 — 이 레이어는 화면 배율을 모른다 (설계 원칙 2).
   */
  topMinutes: number
}

export interface TodoCluster {
  /**
   * React 키. 구성원 id를 이어 만들므로 묶음의 구성이 바뀌면 키도 바뀐다.
   * 드래그로 한 항목이 빠져나가면 다른 카드로 취급되는 게 맞다.
   */
  id: string
  /** 구성원 중 가장 이른 시작 */
  startOffset: number
  /** 구성원 중 가장 늦은 종료 */
  endOffset: number
  /**
   * 카드를 오른쪽으로 몇 칸 밀지. 아래에 구글·로컬 블록이 깔려 있으면 1이다 —
   * 전폭으로 얹으면 그 시간에 뭐가 있었는지가 통째로 사라진다.
   */
  stackIndex: number
  /** 카드 안에 실제로 그려지는 줄 (시작 시각 오름차순) */
  rows: TodoClusterRow[]
  /** 카드 높이가 모자라 접힌 개수. 0이면 전부 보인다. */
  hiddenCount: number
}

export interface TodoClusterResult {
  clusters: TodoCluster[]
  /**
   * 카드에 들어간 TODO의 id. 렌더러는 이것들을 **단독 블록으로 그리지 않는다** —
   * 안 걸러내면 카드와 블록이 같은 자리에 두 번 그려진다.
   */
  clusteredIds: Set<string>
}

/**
 * 줄을 자기 시작 시각 높이에 놓는다. 앞 줄과 부딪힐 때만 최소로 밀어낸다.
 *
 * 위에서부터 차례로 쌓으면 14시에 시작하는 것도 13시 칸에 붙어 버려 "언제 시작하는지"를
 * 글자로만 읽게 된다. 시작 시각은 도형으로 읽히는 게 낫다 — 끝 시각은 어차피 한 줄짜리라
 * 도형으로 나타낼 수 없으므로 글자로 적는다.
 */
function layoutRows(
  members: PlacedBlock[],
  startOffset: number,
  rowHeightMinutes: number,
): TodoClusterRow[] {
  const rows: TodoClusterRow[] = []
  let cursor = 0

  for (const block of members) {
    const topMinutes = Math.max(block.startOffset - startOffset, cursor)
    rows.push({ block, topMinutes })
    cursor = topMinutes + rowHeightMinutes
  }

  return rows
}

function makeCluster(members: PlacedBlock[], rowHeightMinutes: number): TodoCluster {
  // 호출자가 startOffset 오름차순으로 넘기므로 첫 항목이 가장 이르다.
  const startOffset = members[0]!.startOffset
  const endOffset = Math.max(...members.map((m) => m.endOffset))

  const laid = layoutRows(members, startOffset, rowHeightMinutes)

  /*
   * 카드 밖으로 밀려난 줄은 접어서 "+N"으로만 알린다.
   * 짧은 구간에 여러 개가 몰린 경우(30분 안에 네 개 등)에만 일어난다.
   *
   * 한 줄도 안 들어가는 카드라도 **한 줄은 보여준다** — 카드만 덩그러니 있으면
   * 무엇이 들어 있는지 짐작할 단서가 없다. 그 줄이 카드보다 살짝 삐져나오는 것은
   * CSS의 min-height가 받아준다.
   */
  const height = endOffset - startOffset
  const fits = laid.filter((r) => r.topMinutes + rowHeightMinutes <= height)
  const rows = fits.length > 0 ? fits : laid.slice(0, 1)

  return {
    id: members.map((m) => m.id).join('+'),
    startOffset,
    endOffset,
    // 구성원 중 하나라도 다른 블록 위에 얹혀 있으면 카드를 민다 (assignStackIndex가 매겨둔 값).
    stackIndex: members.some((m) => m.stackIndex > 0) ? 1 : 0,
    rows,
    hiddenCount: members.length - rows.length,
  }
}

/**
 * 서로 겹치는 TODO를 묶는다.
 *
 * 겹침은 **타고 이어진다** — A와 B가 겹치고 B와 C가 겹치면 A와 C가 안 겹쳐도 한 묶음이다.
 * 그래야 셋이 한 카드 안에서 서로 안 겹치는 줄로 정리된다. 카드가 길어지더라도 줄이
 * 각자 자기 시작 시각 높이에 있으므로 누가 어디쯤인지 그대로 읽힌다.
 *
 * @param blocks `layoutDay`가 돌려준 것 — **startOffset 오름차순이어야 한다.**
 * @param rowHeightMinutes 한 줄이 차지하는 높이를 분으로 환산한 값 (렌더러가 px에서 계산해 넘긴다)
 */
export function buildTodoClusters(
  blocks: PlacedBlock[],
  rowHeightMinutes: number,
): TodoClusterResult {
  const clusters: TodoCluster[] = []
  const clusteredIds = new Set<string>()

  let group: PlacedBlock[] = []
  let groupEnd = -1

  const flush = (): void => {
    // 혼자면 카드를 만들지 않는다 — 평범한 블록 그대로가 가장 잘 읽힌다.
    if (group.length >= 2) {
      clusters.push(makeCluster(group, rowHeightMinutes))
      for (const b of group) clusteredIds.add(b.id)
    }
    group = []
    groupEnd = -1
  }

  for (const block of blocks) {
    if (block.kind !== 'todo') continue

    // 정렬돼 있으므로, 지금까지 모인 것들의 끝보다 늦게 시작하면 어느 것과도 안 겹친다.
    if (group.length > 0 && block.startOffset >= groupEnd) flush()

    group.push(block)
    groupEnd = Math.max(groupEnd, block.endOffset)
  }
  flush()

  return { clusters, clusteredIds }
}
