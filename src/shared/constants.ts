/** 매직 넘버는 전부 여기 모은다 (CLAUDE.md 코드 컨벤션). */

/** 부팅 자동 앵커를 올림할 단위. 06:40 → 07:00 */
export const ANCHOR_SNAP_MINUTES = 30

/**
 * 앵커를 손으로 지정할 때의 단위 (00/30분).
 *
 * 앵커는 그날 큐 전체의 출발점이라 정밀할 이유가 없다. 오히려 굵게 잡아야
 * 스크롤 몇 번으로 맞출 수 있다. 부팅 자동 앵커(`ANCHOR_SNAP_MINUTES`)와도 같은 격자다.
 */
export const ANCHOR_STEP_MINUTES = 30

/**
 * 시각을 손으로 입력할 때의 단위 (TODO 슬롯·구글 일정).
 *
 * 1분 단위로 열어두면 스크롤을 수십 번 굴려야 하고, "19:07~20:23" 같은 값이 들어가
 * 그리드 전체가 지저분해진다. 앵커보다는 잘게 두어야 실제 일정에 맞출 수 있다.
 */
export const TIME_STEP_MINUTES = 10

/** 드래그로 옮기거나 길이를 바꿀 때 붙는 격자. 설정에서 고른다 */
export const MOVE_UNIT_CHOICES = [10, 20, 30, 40, 50] as const

/** 하루의 기준 시각 기본값. 올빼미형이라 자정이 아니다. */
export const DEFAULT_DAY_START_HOUR = 6

/** 마감 카운트다운 색상 임계값 (분) */
export const DEADLINE_WARN_MINUTES = 24 * 60
export const DEADLINE_URGENT_MINUTES = 6 * 60

/** 같은 카테고리가 인접할 때 교차시킬 명도 차 (%p) */
export const CATEGORY_LIGHTNESS_STEP = 8

// ── 구글 캘린더 ──────────────────────────────────────────────────────────────

/**
 * 필요한 최소 권한만 받는다.
 * 전체 `calendar` 스코프는 캘린더 생성·삭제까지 되므로 쓰지 않는다.
 */
export const GOOGLE_SCOPES = [
  // 이벤트 조회 + 수정 (홀드 이동 시 PATCH)
  'https://www.googleapis.com/auth/calendar.events',
  // 어떤 캘린더를 동기화할지 고르기 위한 목록 조회
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

/** 브라우저에서 로그인을 기다리는 시간 */
export const GOOGLE_AUTH_TIMEOUT_MS = 5 * 60 * 1000

/** 주기적 동기화 간격 */
export const GOOGLE_SYNC_INTERVAL_MS = 5 * 60 * 1000

/** 동기화 범위 — 이월이 과거를 돌아보므로 뒤쪽도 조금 잡는다 */
export const GOOGLE_SYNC_PAST_DAYS = 7
export const GOOGLE_SYNC_FUTURE_DAYS = 45

/**
 * 이 앱에서 만든 구글 일정에 붙일 알림 (분 전). `null`이면 알림 없음.
 *
 * 캘린더의 기본 알림을 따르지 않고(`useDefault: false`) 우리가 정한 것만 넣는다 —
 * 캘린더마다 기본값이 달라서, 그대로 두면 위젯에서 만든 일정의 알림이 제각각이 된다.
 * **이메일 알림은 넣지 않는다.** 위젯에서 툭툭 만드는 일정 하나하나가 메일함에 쌓이면
 * 그 순간 메일함이 못 쓰게 된다. 화면 팝업만 쓴다.
 */
export const GOOGLE_REMINDER_CHOICES = [null, 0, 5, 10, 15, 30, 60] as const
export const DEFAULT_GOOGLE_REMINDER_MINUTES = 10

/** 우클릭으로 만드는 구글 일정의 기본 길이 */
export const NEW_GOOGLE_EVENT_MINUTES = 60

// ── 채팅 (LLM) ───────────────────────────────────────────────────────────────

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
/** 이 값은 응답 형식의 계약이다. 올리기 전에 변경점을 확인할 것 */
export const ANTHROPIC_API_VERSION = '2023-06-01'

/**
 * 고를 수 있는 모델. 앞쪽이 기본.
 *
 * 기본이 Haiku인 이유: 이 앱이 시키는 일은 "한 줄을 도구 호출로 옮기기"라 추론이 거의 없고,
 * 대신 **위젯에서 치고 바로 닫는** 흐름이라 응답이 늦으면 그 자체로 쓸모가 준다.
 * 큰 모델은 한 줄에 여러 일정을 섞어 넣는 복잡한 명령이 자주 틀릴 때만 올린다.
 */
export const LLM_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'] as const
export type LlmModel = (typeof LLM_MODELS)[number]
export const DEFAULT_LLM_MODEL: LlmModel = 'claude-haiku-4-5-20251001'

export const LLM_MODEL_LABEL: Record<LlmModel, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5 (빠름·저렴, 기본)',
  'claude-sonnet-5': 'Sonnet 5 (균형)',
  'claude-opus-5': 'Opus 5 (가장 똑똑함)',
}

export const LLM_MAX_TOKENS = 2048

/**
 * 한 번의 사용자 요청에서 도구를 몇 번까지 이어 부를 수 있는지.
 * 모델이 같은 도구를 반복 호출하며 도는 경우를 끊는다.
 */
export const LLM_MAX_TOOL_ROUNDS = 8

/** 채팅이 한 번에 들여다보는 날짜 범위 (오늘 기준) */
export const LLM_CONTEXT_PAST_DAYS = 1
export const LLM_CONTEXT_FUTURE_DAYS = 13
