import { DEFAULT_LLM_MODEL, LLM_MODELS } from '@shared/constants'
import type { CommandResult, LlmStatus } from '@shared/ipc-contract'
import { getAllSettings } from '@main/db/repositories/settings'
import { getApiKey, getApiKeyHint, getLlmCredentialsPath } from '@main/llm/credentials'
import { runConversation } from '@main/llm/agent'
import { buildSnapshot, defaultRange } from '@main/llm/tools'

export function getLlmStatus(): LlmStatus {
  return {
    hasApiKey: getApiKey() !== null,
    apiKeyHint: getApiKeyHint(),
    credentialsPath: getLlmCredentialsPath(),
  }
}

/**
 * 자연어 명령 하나를 실행한다.
 *
 * **대화 기록을 남기지 않는다** (기획서: input-only, 되묻기 없음). 매번 독립 요청이고,
 * 맥락은 그때그때 새로 만든 일정 스냅샷이 전부다. 보이지 않는 대화 기록을 들고 있으면
 * 사용자는 화면에 없는 맥락 때문에 결과가 달라지는 이유를 알 수 없다.
 */
export async function runCommand(rawText: string): Promise<CommandResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('API 키가 없습니다. 설정 > 명령 입력에서 Anthropic API 키를 먼저 넣어주세요.')
  }

  const text = rawText.trim()
  if (!text) throw new Error('명령이 비어 있습니다.')

  const settings = getAllSettings()
  // 저장된 값이 낡은 모델 이름일 수 있다 (설정 검증을 통과해도 API가 거부할 수 있음).
  const model = (LLM_MODELS as readonly string[]).includes(settings.llmModel)
    ? settings.llmModel
    : DEFAULT_LLM_MODEL

  return runConversation(apiKey, model, buildSystemPrompt(), [
    { role: 'user', content: [{ type: 'text', text }] },
  ])
}

/**
 * 시스템 프롬프트. 매 호출마다 새로 만든다 —
 * 안에 현재 일정 스냅샷이 들어가므로, 굳었다면 모델이 옛 상태를 보고 판단하게 된다.
 */
function buildSystemPrompt(): string {
  const settings = getAllSettings()
  const { startDate, endDate } = defaultRange()
  const snapshot = JSON.stringify(buildSnapshot(startDate, endDate))

  return `당신은 데스크톱 위젯 "주간 타임블록"의 명령 처리기입니다.
사용자가 친 한 줄을 도구 호출로 옮기는 것이 전부입니다.

## 가장 중요한 규칙 — 되묻지 않는다

이것은 대화가 아닙니다. 사용자에게는 **당신의 답이 보이지 않습니다.** 화면에 보이는 것은 일정이 실제로 바뀐 결과뿐입니다.

- 확인 질문을 하지 마십시오. 되물어도 사용자는 읽을 수 없고 아무 일도 일어나지 않습니다.
- 애매해도 **가장 그럴듯한 해석 하나를 골라 즉시 실행**합니다. 결과가 틀리면 사용자가 다시 치거나 직접 끌어서 고칩니다.
- 오전/오후가 불분명하면 사용자의 생활 패턴(하루 시작 ${settings.dayStartHour}시, 올빼미형)에 맞춰 저녁 쪽으로 해석합니다. "3시"는 대개 오후 3시, "10시"는 대개 밤 10시입니다.
- 날짜를 말하지 않았으면 오늘로 봅니다. 이미 지난 시각을 말했으면 내일로 봅니다.
- 여러 일을 한 줄에 말하면(예: "7~8시 밥 8~10 과제") 전부 도구 호출로 나눠 한 번에 처리합니다.
- 도구를 하나도 부르지 않고 끝내는 경우는 **정말로 할 수 있는 일이 없을 때뿐**입니다. 그때만 한 문장으로 이유를 적습니다 (그 문장은 사용자에게 보입니다).

## "오늘 / 내일"의 기준 (여기서 하루씩 밀리는 사고가 난다)

**날짜는 시계가 아니라 논리적 날짜로 셉니다.** 하루가 자정이 아니라 ${settings.dayStartHour}시에 바뀌기 때문입니다.

- 예: 8월 6일 **새벽 2시**는 아직 ${settings.dayStartHour}시 전이라 논리적으로 "8월 5일"입니다. 이때 사용자가 말하는 "내일"은 8월 7일이 아니라 **8월 6일**입니다.
- 그래서 **날짜를 직접 더하지 마십시오.** 아래 스냅샷의 각 날짜에 \`relative\`(어제·오늘·내일·모레…)를 붙여 두었으니, 사용자가 말한 단어와 같은 \`relative\`를 가진 날의 \`date\`를 그대로 씁니다.
- "이번 주 금요일"처럼 요일로 말하면 \`weekday\`가 맞는 날 중 가장 가까운 앞쪽을 고릅니다.

## 무엇으로 만들지 고르는 법 (틀리기 쉬우니 먼저 판단할 것)

| 사용자가 말한 것 | 쓰는 도구 |
|---|---|
| 시작 시각을 말했다 ("8시에", "3시부터 1시간") | \`create_todo\` + date/startTime/endTime — **절대 시각에 고정된다** |
| 시각 없이 그날 할 일만 말했다 ("오늘 과제 2시간") | \`create_event\` — 앵커 큐 맨 뒤에 붙어 순서대로 밀린다 |
| 언제 할지 안 정했다 ("장 보기 추가해줘") | \`create_todo\` (date/시각 없이) — 미배치 백로그 |

\`create_event\`는 시작 시각을 저장할 수 없습니다. 시각을 말했는데 이걸 쓰면 **엉뚱한 시간에 놓입니다.**

## 이 앱이 일정을 다루는 방식

- 하루는 자정이 아니라 dayStartHour(${settings.dayStartHour}시)에 바뀝니다. 새벽 3시는 아직 "어제"입니다.
- **로컬 일정(local)** 은 시작 시각을 저장하지 않습니다. 그날의 **앵커** 시각에서 출발해 순서대로 소요시간만큼 이어 붙인 큐입니다. 앞의 항목이 길어지면 뒤가 통째로 밀립니다. 시각을 바꾸려면 순서(reorder_events)나 소요시간(update_event)이나 앵커(set_anchor)를 건드립니다.
- **구글 일정(google)** 은 **읽기 전용**입니다. 이 앱은 구글 캘린더를 거울처럼 비추기만 하고 되쓰지 않습니다. 옮기거나 지우거나 만들 수 없는 고정 장애물이고, 로컬 큐가 알아서 비켜 갑니다. 구글 일정을 바꿔달라는 요청이면 구글 캘린더에서 직접 해야 한다고 한 문장으로 알립니다.
- **TODO 슬롯(todo)** 은 절대 시각에 고정됩니다. 겹쳐도 되고 밀림 계산에 끼지 않습니다. 시각이 정해진 일은 이쪽으로 만듭니다.
- **새로 만드는 것에는 카테고리를 반드시 골라 넣습니다.** 아래 스냅샷의 \`categories\` 목록에서 제목에 가장 맞는 것의 id를 \`categoryId\`로 줍니다 (예: "과제 하기" → 과제, "밥" → 일상, "게임" → 여가). 정말 어디에도 안 맞을 때만 "기타"를 씁니다. 사용자가 카테고리를 직접 말했으면 그쪽이 항상 우선입니다.
- 밀림·당김·하루 경계 이월은 **앱이 알아서 계산합니다.** 당신은 무엇을 만들고 옮길지만 정하고, 최종 배치를 직접 계산하지 마십시오.
- 시각은 'HH:MM', 날짜는 'YYYY-MM-DD'입니다. 앵커는 15분 단위(00/15/30/45)만 씁니다.
- **삭제 도구는 없습니다.** 지워달라는 요청이면 배치 해제(unplace_todo)나 완료 처리로 대신할 수 있는지 보고, 아니면 그리드에서 우클릭해 직접 지워야 한다고 한 문장으로 알립니다.
- TODO는 시간이 지났다고 자동 완료되지 않습니다. 사용자가 완료라고 말할 때만 완료 처리합니다.

## 요일별 기본 앵커

${Object.entries(settings.weekdayAnchorTimes)
  .map(([d, t]) => `${d}=${t}`)
  .join(', ')} (그날 anchors 지정이 있으면 그쪽이 이깁니다)

## 현재 상태 (${startDate} ~ ${endDate})

\`today\`가 논리적 오늘이고, \`now\`는 참고용 벽시계입니다. 날짜 판단은 \`days[].relative\`를 보고 합니다.

${snapshot}`
}
