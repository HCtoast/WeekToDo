/**
 * 메인 <-> 렌더러 IPC 계약.
 * 채널 이름과 페이로드 타입을 한 곳에 두고 양쪽에서 import 한다.
 * 렌더러는 여기 정의된 것 외의 방법으로 메인에 접근하지 않는다.
 */

import type { AppSettings, SettingKey, WidgetSizeMode } from '@shared/settings-schema'
import type { CategoryRow, DateStr, TimeStr } from '@shared/types'
import type { FixedBlock, QueueItem } from '@shared/scheduler'
import type { DeadlineSpec } from '@shared/deadline'

export const IPC = {
  ping: 'app:ping',
  dbInfo: 'db:info',
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  categoriesList: 'categories:list',
  scheduleLoad: 'schedule:load',
  scheduleMutate: 'schedule:mutate',
  historyLoad: 'history:load',
  windowApply: 'window:apply',
  windowSizeMode: 'window:sizeMode',
  windowInteractive: 'window:interactive',
  launchAtLoginGet: 'launch:get',
  launchAtLoginSet: 'launch:set',
  googleStatus: 'google:status',
  googleSetClient: 'google:setClient',
  googleConnect: 'google:connect',
  googleDisconnect: 'google:disconnect',
  googleListCalendars: 'google:listCalendars',
  googleSyncNow: 'google:syncNow',
  llmStatus: 'llm:status',
  llmSetKey: 'llm:setKey',
  llmRun: 'llm:run',
  commandOpen: 'command:open',
  commandClose: 'command:close',
  devSeed: 'dev:seed',
} as const

/** 메인 → 렌더러 알림 (트레이 메뉴 등 창 밖에서 일어난 일) */
export const IPC_EVENT = {
  settingsChanged: 'settings:changed',
  settingsOpen: 'settings:open',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Phase 0/1 연결 확인용 — 스케줄 기능이 붙으면 제거한다. */
export interface DbInfo {
  /** 링크된 SQLite 엔진 버전 */
  sqliteVersion: string
  /** app.getPath('userData')/app.db */
  dbPath: string
  /** WAL 모드 적용 여부 */
  journalMode: string
  /** 외래키 제약 활성화 여부 */
  foreignKeys: boolean
  /** user_version PRAGMA */
  schemaVersion: number
  /** 코드가 기대하는 최신 마이그레이션 번호 */
  expectedSchemaVersion: number
  /** 생성된 테이블 이름 */
  tables: string[]
}

/**
 * 하루치 원본 데이터. 표시 시각은 렌더러가 layoutDay로 계산한다
 * (메인이 계산해서 내려주면 드래그 중 미리보기를 매번 IPC로 왕복해야 한다).
 */
export interface DaySchedule {
  date: DateStr
  /** resolveAnchor 결과 — 항상 값이 있다 */
  anchorTime: TimeStr
  /** anchors 행에서 온 값인지, 요일 기본값에서 파생된 값인지 */
  anchorIsOverride: boolean
  /** order_index 오름차순 */
  queue: QueueItem[]
  /** 시각이 있는 구글 이벤트. 로컬 큐를 미는 고정 장애물 */
  googleEvents: FixedBlock[]
  /**
   * 종일 일정. 하루를 통째로 차지하므로 그리드 블록이 아니라 날짜 머리에 따로 표시하고,
   * 밀림 계산에서는 제외한다 ("종일 예비군"이 있다고 그날 저녁 큐가 사라지면 안 된다).
   */
  allDayEvents: { id: string; title: string }[]
  todoSlots: FixedBlock[]
}

export interface TodoData {
  id: string
  title: string
  categoryId: string | null
  completed: boolean
  /** 정규화된 절대 마감. 카운트다운은 이 값 하나만 본다 */
  deadline: string | null
  /** 원본 의도 — 수정할 때 "생성일 기준 N일"을 유지하려고 남긴다 */
  deadlineType: 'absolute' | 'relative' | null
  deadlineRelativeDays: number | null
  description: string | null
  url: string | null
}

/**
 * 구글 이벤트의 상세. `days[].googleEvents`가 그리드용 최소 정보만 담는 것과 짝이며,
 * TODO에서 `todos`가 하는 역할과 같다 — 블록에서 상세를 열 때 여기서 찾는다.
 */
export interface GoogleEventData {
  id: string
  title: string
  date: DateStr
  startTime: TimeStr
  endTime: TimeStr
  description: string | null
  location: string | null
  isAllDay: boolean
  /** 반복 일정의 인스턴스인지 — 고치면 그 회차만 바뀐다는 안내에 쓴다 */
  isRecurring: boolean
}

export interface ScheduleData {
  /** 논리적 오늘 (dayStartHour 반영) */
  today: DateStr
  days: DaySchedule[]
  /** 화면에 보이는 기간의 구글 이벤트 상세 */
  googleEvents: GoogleEventData[]
  /** 백로그 + 화면에 배치된 TODO. 그리드 블록에서 상세를 열 때도 여기서 찾는다 */
  todos: TodoData[]
  /** 그 중 시간대가 없는 것 (표시 순서대로) */
  backlogIds: string[]
}

/**
 * 쓰기 요청. 채널을 액션마다 만들지 않고 하나로 묶는다 —
 * 액션이 십수 개로 늘어나도 계약/preload/핸들러 세 곳에 같은 이름을 반복해 적지 않아도 된다.
 */
export type Mutation =
  | { type: 'localEvent.create'; date: DateStr; title: string; durationMinutes: number; categoryId: string | null }
  | {
      type: 'localEvent.update'
      id: string
      patch: {
        title?: string
        durationMinutes?: number
        categoryId?: string | null
        isHeld?: boolean
        completed?: boolean
      }
    }
  /** 드래그로 순서를 바꾼 뒤 그날 큐 전체의 id를 새 순서대로 보낸다 */
  | { type: 'localEvent.reorder'; date: DateStr; orderedIds: string[] }
  | { type: 'localEvent.delete'; id: string }
  /** anchors 행을 만들거나 갱신한다 (source='manual') */
  | { type: 'anchor.set'; date: DateStr; anchorTime: TimeStr }
  /** override를 지워 요일 기본값으로 되돌린다 */
  | { type: 'anchor.clear'; date: DateStr }
  | { type: 'todo.create'; title: string; categoryId: string | null }
  /**
   * TODO를 만들면서 곧바로 그 시각에 배치한다.
   * 두 번의 mutation으로 나누면 사이에 한 번 더 조회가 돌아 백로그에 잠깐 나타났다 사라진다.
   */
  | {
      type: 'todo.createAt'
      title: string
      date: DateStr
      startTime: TimeStr
      endTime: TimeStr
      categoryId?: string | null
    }
  | {
      type: 'todo.update'
      id: string
      patch: {
        title?: string
        description?: string | null
        url?: string | null
        categoryId?: string | null
        completed?: boolean
        /** 지정하면 deadline_computed까지 메인이 정규화해 저장한다 */
        deadline?: DeadlineSpec
      }
    }
  | { type: 'todo.delete'; id: string }
  | { type: 'todo.reorderBacklog'; orderedIds: string[] }
  | { type: 'todoSlot.create'; todoId: string; date: DateStr; startTime: TimeStr; endTime: TimeStr }
  | {
      type: 'todoSlot.update'
      id: string
      patch: { date?: DateStr; startTime?: TimeStr; endTime?: TimeStr }
    }
  | { type: 'todoSlot.delete'; id: string }
  /**
   * 구글 이벤트의 홀드. `is_held`는 구글이 모르는 **로컬 소유** 값이라 로컬 DB만 바뀐다
   * (동기화가 이 컬럼을 보존한다).
   */
  | { type: 'googleEvent.setHeld'; id: string; isHeld: boolean }
  /**
   * 구글에서 일정을 지운다. **이 앱의 유일한 되돌릴 수 없는 조작**이라
   * 화면에서 한 번 더 확인을 받은 뒤에만 보낸다 (자동 판단은 절대 보내지 않는다).
   */
  | { type: 'googleEvent.delete'; id: string }
  /** 실제 구글 캘린더에 새 일정을 만든다 (알림은 설정값을 따른다) */
  | {
      type: 'googleEvent.create'
      title: string
      date: DateStr
      startTime: TimeStr
      endTime: TimeStr
      description?: string | null
      location?: string | null
    }
  /**
   * 구글 이벤트 수정. 이것만 유일하게 **로컬 DB 밖**으로 나간다 —
   * 구글에 PATCH를 보내고 성공하면 캐시를 다시 받아온다.
   * 실패하면 캐시가 그대로라 화면이 다시 읽는 순간 원래대로 돌아간다.
   */
  | {
      type: 'googleEvent.update'
      id: string
      patch: {
        title?: string
        date?: DateStr
        startTime?: TimeStr
        endTime?: TimeStr
        description?: string | null
        location?: string | null
      }
    }

/** 히스토리는 논리적 날짜로 묶는다 — 새벽 2시에 체크한 항목은 "어제" 완료다. */
export interface HistoryDay {
  date: DateStr
  items: { id: string; title: string; categoryId: string | null; completedAt: string }[]
}

/**
 * 구글 연결 상태. 클라이언트 시크릿과 토큰은 **절대 렌더러로 내려보내지 않는다** —
 * 있는지 여부와 연결된 계정만 알려준다.
 */
export interface GoogleStatus {
  hasClientCredentials: boolean
  connected: boolean
  account: string | null
  /** 자격증명 파일 경로 (문제 생겼을 때 안내용) */
  credentialsPath: string
  lastSyncedAt: string | null
  lastError: string | null
}

export interface GoogleCalendarInfo {
  id: string
  summary: string
  primary: boolean
  backgroundColor: string | null
}

/**
 * 명령 입력 상태. **API 키는 절대 내려보내지 않는다** — 있는지 여부와 꼬리 4자만.
 */
export interface LlmStatus {
  hasApiKey: boolean
  /** 어떤 키를 넣었는지 알아보기 위한 마지막 네 자리 */
  apiKeyHint: string | null
  credentialsPath: string
  /** 명령 로그(JSONL) 경로 — 명령이 왜 그렇게 해석됐는지 되짚을 때 연다 */
  logPath: string
}

/** 도구 한 번의 실행 기록 */
export interface CommandAction {
  /** 도구 이름 (create_todo 등) */
  tool: string
  /** 사람이 읽을 한 줄 요약 */
  summary: string
  ok: boolean
}

/**
 * 명령 한 번의 결과.
 *
 * 이 인터페이스는 **대화가 아니다** (기획서: input-only, 되묻기 없음).
 * 정상적으로 뭔가를 했으면 피드백은 위젯에 실제로 반영된 결과가 준다.
 * `text`는 아무것도 하지 못했을 때(못 알아들었다, 구글이라 못 바꾼다) 그 이유를
 * 알려주기 위해서만 쓴다 — 그마저 없으면 사용자는 왜 아무 일도 없었는지 알 수 없다.
 */
export interface CommandResult {
  text: string
  actions: CommandAction[]
}

export interface Api {
  ping(): Promise<string>
  dbInfo(): Promise<DbInfo>
  getSettings(): Promise<AppSettings>
  setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<void>
  listCategories(): Promise<CategoryRow[]>
  loadSchedule(dates: DateStr[]): Promise<ScheduleData>
  loadHistory(): Promise<HistoryDay[]>
  mutate(mutation: Mutation): Promise<void>
  /** 저장된 widgetMode / clickThrough를 실제 창에 적용한다 */
  applyWindowMode(): Promise<void>
  /**
   * 클릭 통과 중에도 잠깐 마우스를 받게 한다.
   * 통과를 끌 방법(설정 버튼/설정창)까지 통과시키면 되돌아올 길이 없어지므로,
   * 그 위에 마우스가 올라간 동안만 true로 켠다.
   */
  setInteractive(interactive: boolean): Promise<void>
  /** 작은 위젯 ↔ 큰 위젯. 각 모드의 마지막 위치를 각각 복원한다 */
  setSizeMode(sizeMode: WidgetSizeMode): Promise<void>
  isLaunchAtLogin(): Promise<boolean>
  setLaunchAtLogin(enabled: boolean): Promise<void>

  googleStatus(): Promise<GoogleStatus>
  /** null이면 저장된 클라이언트 자격증명을 지운다 */
  googleSetClient(creds: { clientId: string; clientSecret: string } | null): Promise<void>
  /** 브라우저를 열어 인증한다. 완료될 때까지 기다린다 */
  googleConnect(): Promise<{ account: string }>
  googleDisconnect(): Promise<void>
  googleListCalendars(): Promise<GoogleCalendarInfo[]>
  googleSyncNow(): Promise<{ events: number }>

  llmStatus(): Promise<LlmStatus>
  /** null이면 저장된 키를 지운다 */
  llmSetKey(key: string | null): Promise<void>
  /**
   * 자연어 명령 한 번을 실행한다. 매번 독립이며 이전 명령을 기억하지 않는다
   * (기획서: fire-and-forget). 매 호출마다 현재 일정 스냅샷을 새로 만들어 넘긴다.
   */
  llmRun(text: string): Promise<CommandResult>
  /** 위젯 위에 명령 입력 창을 띄운다 */
  openCommandWindow(): Promise<void>
  /** 명령 입력 창이 스스로 닫을 때 (Esc, 실행 완료) */
  closeCommandWindow(): Promise<void>

  /** 트레이 메뉴 등에서 설정이 바뀌면 호출된다. 해제 함수를 돌려준다. */
  onSettingsChanged(handler: () => void): () => void
  /** 트레이의 "설정…" — 클릭 통과로 위젯을 못 만질 때의 탈출구이기도 하다 */
  onOpenSettings(handler: () => void): () => void
  /** 개발용 — 실제 입력 UI가 갖춰지면 제거 */
  seedSample(): Promise<void>
}
