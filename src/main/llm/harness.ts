import type { Mutation } from '@shared/ipc-contract'
import { setMutationInterceptor } from '@main/db/mutations'
import { runCommand } from '@main/llm'

/**
 * 자연어 명령 하네스 — 창 없이 여러 문장을 돌려보고 결과를 표로 뱉는다.
 *
 * 왜 필요한가: 프롬프트를 고칠 때마다 위젯을 띄우고 손으로 치고 로그를 읽는 건 느리고,
 * 모델 출력은 매번 조금씩 달라서 한 번 쳐보고 "고쳤다"고 판단하면 틀린다.
 * 같은 문장을 여러 번 돌려 **몇 번 맞히는지**로 봐야 한다.
 *
 * 실제 코드 경로를 그대로 탄다 (DB·API 키·프롬프트·도구). UI 자동화가 필요 없다.
 *
 * ```
 * npm run llm:try -- "명조 10시로 옮겨줘" "3시로 옮겨줘"
 * npm run llm:try -- --repeat=3 --apply "..."
 * ```
 *
 * 기본은 **dry-run**이다 — 도구는 정상적으로 고르게 두되 DB 쓰기만 가로채 기록한다.
 * 실제로 반영하려면 `--apply`를 준다.
 */

export interface HarnessCase {
  input: string
  /** 이 명령이 부른 도구와 인자 (회차별) */
  runs: {
    tools: { name: string; input: unknown }[]
    mutations: Mutation[]
    /** 도구를 하나도 못 불렀을 때 사용자에게 보였을 한 줄 */
    text: string
    ms: number
    error?: string
  }[]
}

/** `--llm-try` 로 들어온 인자를 가른다 */
export function parseHarnessArgs(argv: string[]): {
  inputs: string[]
  repeat: number
  apply: boolean
} | null {
  if (!argv.includes('--llm-try')) return null

  const rest = argv.slice(argv.indexOf('--llm-try') + 1)
  const repeat = Number(rest.find((a) => a.startsWith('--repeat='))?.slice(9) ?? 1)

  return {
    inputs: rest.filter((a) => !a.startsWith('--')),
    // 회차는 1~10으로 묶는다 — 손이 미끄러져 100을 넣으면 요금만 나간다.
    repeat: Number.isFinite(repeat) ? Math.min(10, Math.max(1, repeat)) : 1,
    apply: rest.includes('--apply'),
  }
}

export async function runHarness(
  inputs: string[],
  repeat: number,
  apply: boolean,
): Promise<HarnessCase[]> {
  const cases: HarnessCase[] = []

  for (const input of inputs) {
    const runs: HarnessCase['runs'] = []

    for (let i = 0; i < repeat; i++) {
      const mutations: Mutation[] = []
      if (!apply) setMutationInterceptor((m) => void mutations.push(m))

      const startedAt = Date.now()
      try {
        const result = await runCommand(input)
        runs.push({
          // 도구 이름은 요약에서 뽑는다 — runCommand는 트레이스를 돌려주지 않는다.
          tools: result.actions.map((a) => ({ name: a.tool, input: a.summary })),
          mutations,
          text: result.text,
          ms: Date.now() - startedAt,
        })
      } catch (e) {
        runs.push({
          tools: [],
          mutations,
          text: '',
          ms: Date.now() - startedAt,
          error: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setMutationInterceptor(null)
      }
    }

    cases.push({ input, runs })
  }

  return cases
}

/** 사람이 읽을 표로. 자세한 인자는 logs/llm-log.jsonl에 이미 남아 있다. */
export function formatHarness(cases: HarnessCase[], apply: boolean): string {
  const lines: string[] = []
  lines.push(`\n=== 자연어 명령 하네스 (${apply ? '실제 반영' : 'dry-run'}) ===\n`)

  for (const c of cases) {
    lines.push(`■ "${c.input}"`)
    c.runs.forEach((r, i) => {
      const head = c.runs.length > 1 ? `  ${i + 1}회차` : '  '
      if (r.error) {
        lines.push(`${head} 오류: ${r.error}`)
        return
      }
      if (r.mutations.length === 0 && r.tools.length === 0) {
        lines.push(`${head} 아무것도 안 함 — "${r.text.slice(0, 80)}"`)
        return
      }
      for (const m of r.mutations) lines.push(`${head} ${m.type} ${JSON.stringify(m)}`)
      for (const t of r.tools) lines.push(`${head} [${t.name}] ${String(t.input)}`)
      lines.push(`${head} (${r.ms}ms)`)
    })
    lines.push('')
  }

  return lines.join('\n')
}
