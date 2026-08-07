import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  LLM_MAX_TOKENS,
  LLM_MAX_TOOL_ROUNDS,
} from '@shared/constants'
import type { CommandAction, CommandResult } from '@shared/ipc-contract'
import { TOOLS, runTool } from '@main/llm/tools'

/**
 * Anthropic Messages API 호출과 도구 루프.
 *
 * SDK를 쓰지 않고 `fetch`로 직접 부른다 — 필요한 엔드포인트가 하나뿐인데
 * 메인은 CJS로 번들되므로 ESM 전용 패키지를 물었다가 `require`에서 깨질 여지를 만들지 않는다
 * (electron-store v11에서 같은 함정을 겪었다).
 */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

interface ApiResponse {
  content: ContentBlock[]
  stop_reason: string | null
}

async function callApi(
  apiKey: string,
  model: string,
  system: string,
  messages: ApiMessage[],
): Promise<ApiResponse> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: LLM_MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    }),
  })

  if (!res.ok) {
    // 응답 본문에 키가 실려 오지는 않지만, 그대로 화면에 뿌리지 않고 요점만 뽑는다.
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${extractApiError(detail) ?? res.statusText}`)
  }

  return (await res.json()) as ApiResponse
}

function extractApiError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return parsed.error?.message ?? null
  } catch {
    return null
  }
}

/**
 * 모델이 도구를 다 쓸 때까지 돌린다.
 *
 * 도구가 던진 오류는 루프를 끊지 않고 `is_error` 결과로 모델에게 돌려준다 —
 * 날짜 형식을 틀린 정도는 스스로 고쳐 다시 부르는 편이 낫다.
 */
export async function runConversation(
  apiKey: string,
  model: string,
  system: string,
  messages: ApiMessage[],
): Promise<CommandResult> {
  const actions: CommandAction[] = []

  for (let round = 0; round < LLM_MAX_TOOL_ROUNDS; round++) {
    const res = await callApi(apiKey, model, system, messages)
    messages.push({ role: 'assistant', content: res.content })

    const toolUses = res.content.filter((b) => b.type === 'tool_use')
    if (toolUses.length === 0) return { text: textOf(res.content), actions }

    const results: ContentBlock[] = []
    for (const use of toolUses) {
      if (use.type !== 'tool_use') continue

      try {
        const outcome = runTool(use.name, use.input)
        if (outcome.summary) actions.push({ tool: use.name, summary: outcome.summary, ok: true })
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(outcome.result),
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        actions.push({ tool: use.name, summary: message, ok: false })
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: message,
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: results })
  }

  // 여기까지 왔다는 건 모델이 도구 호출을 멈추지 않았다는 뜻.
  return {
    text: '한 번에 너무 많은 걸 시켰습니다. 나눠서 다시 쳐 주세요.',
    actions,
  }
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim()
}

