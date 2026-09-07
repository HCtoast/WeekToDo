import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { LLM_LOG_MAX_BYTES } from '@shared/constants'
import type { CommandResult } from '@shared/ipc-contract'

/**
 * 자연어 명령 한 번을 통째로 남기는 로그.
 *
 * 이 앱의 명령 입력은 **대화가 아니라서** 화면에 아무 흔적이 없다 — 잘 되면 위젯이 바뀔 뿐이고,
 * 어긋나면 "왜 저기에 놓였지"를 되짚을 근거가 없다. 그 근거를 여기에 남긴다.
 *
 * 한 줄 = JSON 하나(JSONL). 통째로 파싱하지 않아도 tail로 마지막 명령만 볼 수 있고,
 * 도중에 앱이 죽어도 앞부분이 성한 채로 남는다.
 *
 * **API 키는 어디에도 실리지 않는다.** 여기 들어가는 것은 사용자가 친 한 줄, 모델의 응답,
 * 도구 호출 인자뿐이다 (전부 이미 사용자 자신의 일정 데이터다).
 */

export interface LlmRoundLog {
  /** 이 왕복 하나에 걸린 시간 */
  ms: number
  stopReason: string | null
  usage: { input: number; output: number } | null
  /** 모델이 뱉은 말. 도구만 부르고 끝나는 왕복에서는 대개 빈 문자열이다 */
  text: string
  /** 이 왕복에서 부른 도구와 그 인자 — 해석이 어긋났을 때 가장 먼저 보는 곳 */
  toolUses: { name: string; input: unknown }[]
}

export interface CommandTrace {
  at: string
  startedAt: number
  model: string
  input: string
  systemChars: number
  /** 프롬프트 전문은 기본적으로 안 남긴다 (아래 shouldLogPrompt 참고) */
  system: string | null
  rounds: LlmRoundLog[]
}

/**
 * 시스템 프롬프트에는 일정 스냅샷이 통째로 들어가 한 번에 수 KB다.
 * 매번 남기면 로그가 스냅샷으로 가득 차 정작 보고 싶은 응답이 밀려난다.
 * 프롬프트 자체를 손보는 동안에만 `WEEKTODO_LLM_LOG_PROMPT=1`로 켠다.
 */
function shouldLogPrompt(): boolean {
  return process.env.WEEKTODO_LLM_LOG_PROMPT === '1'
}

/**
 * 로그 파일 경로.
 *
 * 개발 중에는 **저장소 안**(`logs/`)에 둔다 — 뭘 봤는지 확인하려고 매번
 * `%APPDATA%`를 열어보는 게 번거롭다. 설치본에는 저장소가 없으므로 userData로 간다.
 */
export function getLlmLogPath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), 'logs')
  return join(dir, 'llm-log.jsonl')
}

export function startTrace(model: string, input: string, system: string): CommandTrace {
  return {
    at: new Date().toISOString(),
    startedAt: Date.now(),
    model,
    input,
    systemChars: system.length,
    system: shouldLogPrompt() ? system : null,
    rounds: [],
  }
}

export function traceRound(trace: CommandTrace, round: LlmRoundLog): void {
  trace.rounds.push(round)
}

export function finishTrace(trace: CommandTrace, result: CommandResult): void {
  write(trace, { ok: true, text: result.text, actions: result.actions })
}

/**
 * 실패도 남긴다 — 오히려 이쪽이 로그가 필요한 쪽이다.
 * 사용자에게는 오류 한 줄만 보이고 몇 번째 왕복에서 깨졌는지는 안 보인다.
 */
export function failTrace(trace: CommandTrace, error: unknown): void {
  write(trace, { ok: false, error: error instanceof Error ? error.message : String(error) })
}

function write(trace: CommandTrace, outcome: Record<string, unknown>): void {
  const { startedAt, ...rest } = trace
  const entry = { ...rest, ms: Date.now() - startedAt, ...outcome }

  try {
    const path = getLlmLogPath()
    // 개발용 logs/ 폴더는 저장소에 없을 수 있다 (gitignore 대상이라 새로 받으면 비어 있다).
    mkdirSync(dirname(path), { recursive: true })
    rotateIfLarge()
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    // 로그를 못 써서 명령이 실패하면 본말이 전도된다. 삼키고 넘어간다.
    console.error('[llm-log] 기록 실패:', e)
  }
}

function rotateIfLarge(): void {
  const path = getLlmLogPath()
  try {
    if (statSync(path).size < LLM_LOG_MAX_BYTES) return
  } catch {
    // 아직 파일이 없다 — 첫 기록이다.
    return
  }
  renameSync(path, path.replace(/\.jsonl$/, '.1.jsonl'))
}
