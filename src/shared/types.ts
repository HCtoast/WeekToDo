/**
 * DB 행 타입.
 * SQLite에는 boolean이 없으므로 0/1 INTEGER를 그대로 노출한다 (변환은 사용처에서).
 * 시각은 'HH:MM', 날짜는 'YYYY-MM-DD', 타임스탬프는 ISO 문자열이다.
 */

/** 'YYYY-MM-DD' — dayStartHour 기준 논리적 날짜 */
export type DateStr = string
/** 'HH:MM' */
export type TimeStr = string
/** ISO 8601 datetime */
export type Timestamp = string

export interface CategoryRow {
  id: string
  name: string
  /** 'hsl(212 70% 55%)' 정규 형식 */
  base_color: string
  /** 낮을수록 먼저. 강제 규칙이 아니라 초기 정렬 힌트 */
  priority: number
  /** 1이면 이 카테고리의 로컬 이벤트에 완료 체크박스를 노출 */
  completable: number
  created_at: Timestamp
}

/**
 * 요일 기본 앵커에 대한 override 기록. 날짜당 최대 1행.
 * 행이 없는 날은 settings.weekdayAnchorTimes에서 파생된다.
 */
export interface AnchorRow {
  id: string
  date: DateStr
  anchor_time: TimeStr
  source: 'manual' | 'autostart'
  created_at: Timestamp
  updated_at: Timestamp
}

/** 앵커 기준 상대 순서 큐. 절대 시각을 저장하지 않는다. */
export interface LocalEventRow {
  id: string
  date: DateStr
  title: string
  duration_minutes: number
  order_index: number
  category_id: string | null
  is_held: number
  completed: number
  completed_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface TodoRow {
  id: string
  title: string
  description: string | null
  url: string | null
  deadline_type: 'absolute' | 'relative' | null
  deadline_absolute: Timestamp | null
  deadline_relative_days: number | null
  /** 카운트다운은 항상 이 값 하나만 본다 */
  deadline_computed: Timestamp | null
  completed: number
  completed_at: Timestamp | null
  include_in_history: number
  category_id: string | null
  /** null이면 categories.priority로 정렬. 값이 있으면 항상 이쪽이 우선 */
  backlog_order: number | null
  created_at: Timestamp
  updated_at: Timestamp
}

/** TODO의 시간대 배치. 겹침을 허용하며 밀림 로직 대상이 아니다. */
export interface TodoTimeSlotRow {
  id: string
  todo_id: string
  date: DateStr
  start_time: TimeStr
  end_time: TimeStr
}

/** 구글 캘린더 읽기 전용 미러. is_held / created_at_original만 로컬 소유. */
export interface GoogleEventRow {
  google_event_id: string
  calendar_id: string
  title: string
  description: string | null
  location: string | null
  date: DateStr
  start_time: TimeStr
  end_time: TimeStr
  is_recurring: number
  recurrence_rule: string | null
  /** 1이면 시각이 없는 종일 일정. 밀림 계산에서 제외한다 */
  is_all_day: number
  is_held: number
  /** 일정별 색 (구글 colorId). 안 칠했으면 null */
  color_id: string | null
  /** 그 일정이 속한 캘린더의 기본색 (#rrggbb) */
  calendar_color: string | null
  created_at_original: Timestamp | null
  last_synced_at: Timestamp
}
