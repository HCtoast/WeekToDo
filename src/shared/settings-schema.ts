import {
  DEFAULT_DAY_START_HOUR,
  DEFAULT_GOOGLE_REMINDER_MINUTES,
  DEFAULT_LLM_MODEL,
  GOOGLE_REMINDER_CHOICES,
  LLM_MODELS,
  MOVE_UNIT_CHOICES,
} from '@shared/constants'
import type { LlmModel } from '@shared/constants'
import type { TimeStr } from '@shared/types'

/**
 * 앱 전역 설정.
 *
 * settings 테이블은 **기본값에서 벗어난 값만** 저장한다 (anchors와 같은 override 방식).
 * 따라서 기본값의 유일한 출처는 이 파일이고, DB에는 기본값을 시드하지 않는다.
 * 새 키를 추가할 때 마이그레이션이 필요 없다는 것도 이 방식의 이점.
 */

export type WeekStartMode = 'saturday' | 'sunday' | 'monday' | 'today' | 'yesterday'
export type WidgetMode = 'fixed' | 'move'
/**
 * 창 뒤를 어떻게 보여줄지.
 * - `acrylic`: OS가 흐려준 유리 (기본)
 * - `clear`: 흐림 없이 바탕화면이 그대로 비친다
 */
export type BackgroundEffect = 'acrylic' | 'clear'
export type WidgetSizeMode = 'small' | 'large'
/**
 * 창을 어느 층에 둘지.
 * - `top`: 항상 다른 창 위 (기본 위젯 동작)
 * - `desktop`: 보통 창처럼 — 바탕화면(움직이는 배경화면 포함) 위, 쓰고 있는 앱 아래
 */
export type WindowLayer = 'top' | 'desktop'
export type MoveUnitMinutes = (typeof MOVE_UNIT_CHOICES)[number]
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export interface WidgetPoint {
  x: number
  y: number
}

export interface WidgetSize {
  width: number
  height: number
}

/**
 * 크기는 모드마다 따로 기억하고 **위치는 하나만** 쓴다.
 *
 * 위치까지 모드별로 두면 펼칠 때 예전에 큰 위젯을 놔뒀던 자리로 창이 점프한다.
 * 좌상단을 고정한 채 크기만 늘었다 줄었다 하는 쪽이 예측 가능하다.
 */
export interface WidgetSizes {
  small: WidgetSize | null
  large: WidgetSize | null
}

export interface AppSettings {
  /** 하루의 기준 시각(0~23). 자정이 아니라 이 시각에 날짜가 바뀐다 */
  dayStartHour: number
  /** 큰 위젯 7일의 시작 기준. 작은 위젯(오늘+내일)에는 적용하지 않는다 */
  weekStartMode: WeekStartMode
  moveUnitMinutes: MoveUnitMinutes
  /** 유리 배경 위에 얹는 틴트의 진하기(%). 올릴수록 유리가 덜 비친다 */
  widgetOpacity: number
  backgroundEffect: BackgroundEffect
  /**
   * 화면 배율 (%). 글자·아이콘·그리드 간격이 함께 커진다.
   *
   * 100~150으로 제한한다. 창 크기는 그대로인데 내용만 커지므로, 더 키우면
   * 7일 뷰의 날짜 열이 창 너비를 넘겨 가로 스크롤이 생기고 레이아웃이 무너진다.
   */
  uiScale: number
  /** 좌상단 좌표. 크기 모드를 바꿔도 이 값은 그대로 유지된다 */
  widgetPosition: WidgetPoint | null
  widgetSize: WidgetSizes
  widgetMode: WidgetMode
  widgetSizeMode: WidgetSizeMode
  /** 항상 위에 띄울지, 바탕화면 위·앱 아래에 둘지 */
  windowLayer: WindowLayer
  /**
   * 고정 모드에서 마우스 입력을 통과시켜 완전히 배경처럼 만든다.
   * 고정 모드와 묶지 않고 따로 둔 이유: 묶으면 고정 모드에서 체크 하나 못 하게 된다.
   */
  clickThrough: boolean
  /** 요일별 기본 앵커 시각. anchors 행이 없는 날의 fallback */
  weekdayAnchorTimes: Record<Weekday, TimeStr>
  /** 시작앱 자동 실행 시각으로 그날 앵커를 자동 기록할지 */
  autoAnchorOnLaunch: boolean
  /**
   * 부팅 시 자동 실행을 **원하는지**. 상주 위젯이라 기본은 켜짐.
   *
   * 레지스트리를 진실로 삼지 않는 이유: 실행 파일이 바뀌면(개발 → 설치본) 레지스트리에는
   * 옛 빌드 항목만 남아 "꺼짐"으로 보이는데, 그걸 사용자가 끈 것으로 오해하면 안 된다.
   */
  launchAtLoginEnabled: boolean
  /**
   * 우리가 만든 시작 항목의 레지스트리 값 이름 (빌드별로 하나).
   *
   * `getLoginItemSettings().launchItems`는 **지금 실행 파일과 경로가 같은 항목만** 돌려주므로,
   * 설치본에서 개발 빌드가 남긴 항목을 지우려면 이름을 미리 기억해두는 수밖에 없다.
   */
  launchAtLoginItems: { name: string; path: string }[]
  /** 이 카테고리로 만든 TODO는 include_in_history를 0으로 초기화 */
  historyExcludedCategoryIds: string[]
  /** 동기화할 구글 캘린더 id. 토큰과 달리 비밀이 아니라 여기 둔다 */
  googleCalendarIds: string[]
  /**
   * 새로 만드는 구글 일정을 어느 캘린더에 넣을지. null이면 고른 것 중 첫 번째.
   * 여러 캘린더를 동기화하면서 쓰기 대상이 매번 달라지면 곤란하다.
   */
  googleWriteCalendarId: string | null
  /**
   * 이 앱에서 만든 구글 일정에 붙일 팝업 알림 (분 전). null이면 알림 없음.
   * 이메일 알림은 넣지 않는다 (메일함이 잠긴다).
   */
  googleReminderMinutes: number | null
  /** 채팅에 쓸 모델. API 키와 달리 비밀이 아니라 여기 둔다 */
  llmModel: LlmModel
  /**
   * 명령 입력 창의 좌상단. null이면 위젯 가운데에 띄운다.
   * 크기는 고정이라 위치만 기억한다.
   */
  commandPosition: WidgetPoint | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  dayStartHour: DEFAULT_DAY_START_HOUR,
  weekStartMode: 'yesterday',
  moveUnitMinutes: 30,
  // 유리 위의 틴트. 너무 낮으면 밝은 acrylic 위에서 블록과 글자의 대비가 죽고,
  // 너무 높으면 애써 만든 유리가 검은 판이 된다.
  widgetOpacity: 72,
  backgroundEffect: 'acrylic',
  uiScale: 100,
  widgetPosition: null,
  widgetSize: { small: null, large: null },
  widgetMode: 'fixed',
  widgetSizeMode: 'small',
  windowLayer: 'desktop',
  clickThrough: false,
  weekdayAnchorTimes: {
    mon: '19:00',
    tue: '19:00',
    wed: '19:00',
    thu: '19:00',
    fri: '19:00',
    sat: '19:00',
    sun: '19:00',
  },
  autoAnchorOnLaunch: true,
  launchAtLoginEnabled: true,
  launchAtLoginItems: [],
  historyExcludedCategoryIds: [],
  googleCalendarIds: [],
  googleWriteCalendarId: null,
  googleReminderMinutes: DEFAULT_GOOGLE_REMINDER_MINUTES,
  llmModel: DEFAULT_LLM_MODEL,
  commandPosition: null,
}

export type SettingKey = keyof AppSettings

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[]

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function isTimeStr(v: unknown): v is TimeStr {
  return typeof v === 'string' && TIME_RE.test(v)
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** 객체가 지정한 키를 전부 숫자로 갖고 있는지 */
function hasNumbers(v: unknown, keys: string[]): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    keys.every((k) => typeof (v as Record<string, unknown>)[k] === 'number')
  )
}

/**
 * 값이 그 키에 유효한지 검사한다.
 * DB 값은 사용자가 손으로 고칠 수도 있고 구버전이 남을 수도 있으므로,
 * 신뢰하지 않고 통과 못 하면 기본값으로 되돌린다.
 */
function isValid<K extends SettingKey>(key: K, v: unknown): v is AppSettings[K] {
  switch (key) {
    case 'dayStartHour':
      return isInt(v, 0, 23)
    case 'weekStartMode':
      return (
        typeof v === 'string' &&
        (['saturday', 'sunday', 'monday', 'today', 'yesterday'] as string[]).includes(v)
      )
    case 'moveUnitMinutes':
      // 예전 값(15/60)이 남아 있어도 여기서 걸러져 기본값으로 되돌아간다.
      return (MOVE_UNIT_CHOICES as readonly number[]).includes(v as number)
    case 'widgetOpacity':
      return isInt(v, 0, 100)
    case 'uiScale':
      return isInt(v, 100, 150) && v % 5 === 0
    // 예전 형식({x,y,width,height} 단일 / 크기 모드별 위치)이 남아 있어도
    // 여기서 걸러져 기본값으로 되돌아간다.
    case 'widgetPosition':
    case 'commandPosition':
      return v === null || hasNumbers(v, ['x', 'y'])
    case 'widgetSize': {
      const isSize = (s: unknown): boolean => s === null || hasNumbers(s, ['width', 'height'])
      return (
        typeof v === 'object' &&
        v !== null &&
        isSize((v as Record<string, unknown>).small) &&
        isSize((v as Record<string, unknown>).large)
      )
    }
    case 'widgetMode':
      return v === 'fixed' || v === 'move'
    case 'backgroundEffect':
      return v === 'acrylic' || v === 'clear'
    case 'widgetSizeMode':
      return v === 'small' || v === 'large'
    case 'windowLayer':
      return v === 'top' || v === 'desktop'
    case 'weekdayAnchorTimes':
      return (
        typeof v === 'object' &&
        v !== null &&
        WEEKDAYS.every((d) => isTimeStr((v as Record<string, unknown>)[d]))
      )
    case 'autoAnchorOnLaunch':
    case 'launchAtLoginEnabled':
    case 'clickThrough':
      return typeof v === 'boolean'
    case 'launchAtLoginItems':
      return (
        Array.isArray(v) &&
        v.every(
          (x) =>
            typeof x === 'object' &&
            x !== null &&
            typeof (x as Record<string, unknown>).name === 'string' &&
            typeof (x as Record<string, unknown>).path === 'string',
        )
      )
    case 'historyExcludedCategoryIds':
    case 'googleCalendarIds':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
    case 'llmModel':
      return typeof v === 'string' && (LLM_MODELS as readonly string[]).includes(v)
    case 'googleWriteCalendarId':
      return v === null || typeof v === 'string'
    case 'googleReminderMinutes':
      return (GOOGLE_REMINDER_CHOICES as readonly (number | null)[]).includes(
        v as number | null,
      )
    default:
      return false
  }
}

/**
 * DB의 JSON 문자열을 값으로 되돌린다.
 * 행이 없거나(null) 깨졌거나 타입이 안 맞으면 기본값.
 */
export function parseSetting<K extends SettingKey>(key: K, raw: string | null): AppSettings[K] {
  if (raw === null) return DEFAULT_SETTINGS[key]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_SETTINGS[key]
  }
  return isValid(key, parsed) ? parsed : DEFAULT_SETTINGS[key]
}

export function serializeSetting<K extends SettingKey>(key: K, value: AppSettings[K]): string {
  if (!isValid(key, value)) {
    throw new Error(`설정값이 유효하지 않습니다: ${key} = ${JSON.stringify(value)}`)
  }
  return JSON.stringify(value)
}

/** DB에서 읽은 override 행들을 기본값 위에 얹어 완전한 설정 객체를 만든다. */
export function resolveSettings(rows: Iterable<{ key: string; value: string }>): AppSettings {
  const result = { ...DEFAULT_SETTINGS }
  for (const { key, value } of rows) {
    if ((SETTING_KEYS as string[]).includes(key)) {
      const k = key as SettingKey
      // 키마다 값 타입이 달라 개별 대입은 좁혀지지 않는다. 검증은 parseSetting이 담당.
      ;(result as Record<string, unknown>)[k] = parseSetting(k, value)
    }
  }
  return result
}
