import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import type {
  BackgroundEffect,
  WidgetMode,
  WidgetSizeMode,
  WindowLayer,
} from '@shared/settings-schema'
import { getAllSettings, getSetting, setSetting } from '@main/db/repositories/settings'
import { appIconPath } from '@main/resources'

/** 저장된 위치가 없을 때 쓰는 기본 크기 */
const DEFAULT_SIZE: Record<WidgetSizeMode, { width: number; height: number }> = {
  small: { width: 460, height: 640 },
  large: { width: 1000, height: 720 },
}

/** 위치 저장은 드래그가 끝난 뒤 한 번만 하면 된다 */
const SAVE_DEBOUNCE_MS = 400

/**
 * Windows 11의 acrylic 배경 재질을 쓸지.
 * 지원하지 않는 OS에서는 기존의 투명 창 + CSS 배경으로 떨어진다.
 */
const USE_ACRYLIC = process.platform === 'win32'

let win: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null
let quitting = false

/** 트레이 메뉴의 "종료"만 실제 종료다. 그 전까지 닫기는 숨기기로 바꾼다. */
export function markQuitting(): void {
  quitting = true
}

export function getWidgetWindow(): BrowserWindow | null {
  return win
}

/** 저장된 좌표가 지금 연결된 모니터 밖이면 화면 밖에 창이 생겨 영영 못 찾는다. */
function isOnSomeDisplay(r: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    // 완전히 벗어나지만 않으면 허용한다 — 모서리에 살짝 걸친 배치는 사용자가 일부러 한 것일 수 있다.
    return r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y
  })
}

function sizeFor(sizeMode: WidgetSizeMode): { width: number; height: number } {
  return getSetting('widgetSize')[sizeMode] ?? DEFAULT_SIZE[sizeMode]
}

/** 좌상단이 화면 안에 남도록 끌어당긴다. 안 하면 펼칠 때 창이 화면 밖으로 나간다. */
function clampToDisplay(x: number, y: number, size: { width: number; height: number }) {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - size.height)),
    ...size,
  }
}

function resolveBounds(sizeMode: WidgetSizeMode): Electron.Rectangle | null {
  const pos = getSetting('widgetPosition')
  if (!pos) return null
  const bounds = { ...pos, ...sizeFor(sizeMode) }
  return isOnSomeDisplay(bounds) ? bounds : null
}

/** 위치는 하나만, 크기는 지금 모드 것만 저장한다. */
function persistBounds(sizeMode: WidgetSizeMode): void {
  if (!win || win.isDestroyed()) return
  const { x, y, width, height } = win.getBounds()
  setSetting('widgetPosition', { x, y })
  setSetting('widgetSize', { ...getSetting('widgetSize'), [sizeMode]: { width, height } })
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => persistBounds(getSetting('widgetSizeMode')), SAVE_DEBOUNCE_MS)
}

/**
 * 이동/고정 모드를 창에 적용한다.
 *
 * 프레임리스 창은 `-webkit-app-region: drag` 영역으로 움직이므로 실제 드래그 차단은 렌더러가 하고,
 * 여기서는 리사이즈와 클릭스루를 다룬다.
 */
let clickThroughActive = false
/**
 * 지금 창이 어떤 배경 효과·배율로 만들어졌는지.
 *
 * 둘 다 **생성 시에만** 안전하게 정할 수 있어, 바뀌면 창을 다시 만든다.
 * - `transparent`는 애초에 생성 옵션이다.
 * - 배율은 런타임 `setZoomFactor`로 바꿀 수 있지만, 투명 창에서는 바꾸기 전 프레임이
 *   얼어붙은 레이어로 남는다 (같은 글자가 크기만 다르게 두 번 보인다).
 *   `invalidate()`로도, 창을 옮기거나 크기를 바꿔도 지워지지 않는다.
 */
let appliedEffect: BackgroundEffect | null = null
let appliedScale: number | null = null
let recreateTimer: NodeJS.Timeout | null = null

/** 슬라이더를 끄는 동안 창이 계속 다시 만들어지지 않도록 잠깐 모아서 처리한다. */
const RECREATE_DEBOUNCE_MS = 450

function scheduleRecreate(): void {
  if (recreateTimer) clearTimeout(recreateTimer)
  recreateTimer = setTimeout(recreateWindow, RECREATE_DEBOUNCE_MS)
}

/**
 * 배경 효과를 바꾸려고 창을 다시 만든다.
 *
 * 위치·크기는 이미 설정에 저장돼 있으므로 그대로 복원된다.
 * `destroy()`로 닫는 이유: 일반 close는 "숨기기"로 가로채져 있어 창이 안 사라진다.
 */
function recreateWindow(): void {
  if (recreateTimer) {
    clearTimeout(recreateTimer)
    recreateTimer = null
  }

  const old = win
  if (!old || old.isDestroyed()) return

  if (saveTimer) clearTimeout(saveTimer)
  persistBounds(getSetting('widgetSizeMode'))

  win = null
  old.destroy()
  createWidgetWindow()
}

/**
 * 창을 어느 층에 둘지 적용한다.
 *
 * - `top`: 'screen-saver' 레벨로 올려 전체화면 앱 위에서도 유지된다.
 * - `desktop`: 보통 창이 된다 — 바탕화면(움직이는 배경화면 포함) 위, 지금 쓰는 앱 아래.
 *
 * Windows에는 "항상 맨 아래"가 없다. 진짜 최하단은 창을 바탕화면(WorkerW)의 자식으로
 * 붙여야 하는데(`electron-as-wallpaper` 류), 그러면 클릭·키보드가 통째로 막혀
 * 체크박스 하나 못 누르는 위젯이 된다. 항상 위를 끄는 것만으로 "쓰고 있는 앱이 위"라는
 * 목적은 달성되므로 여기까지만 한다.
 */
function applyLayer(layer: WindowLayer): void {
  if (!win || win.isDestroyed()) return

  if (layer === 'top') {
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    win.setAlwaysOnTop(false)
  }
}

export function applyWidgetMode(
  mode: WidgetMode,
  clickThrough: boolean,
  uiScale = 100,
  backgroundEffect: BackgroundEffect = 'acrylic',
  layer: WindowLayer = 'desktop',
): void {
  if (!win || win.isDestroyed()) return
  win.setResizable(mode === 'move')
  win.setMovable(mode === 'move')
  applyLayer(layer)

  /*
   * 배경 효과·배율은 창을 다시 만들어 적용한다 (위 appliedEffect 주석 참고).
   * 이 함수는 설정 저장 IPC 안에서 불리므로, 그 자리에서 창을 부수면 호출한 렌더러가
   * 사라지며 invoke가 거부된다. 그래서 항상 뒤로 미뤄서 처리한다.
   */
  if (backgroundEffect !== appliedEffect || uiScale !== appliedScale) {
    appliedEffect = backgroundEffect
    appliedScale = uiScale
    scheduleRecreate()
    return
  }

  // 이동 모드에서까지 클릭이 통과하면 창을 잡을 수 없다.
  clickThroughActive = clickThrough && mode === 'fixed'
  // forward: true 라야 무시 중에도 마우스 이동 이벤트가 렌더러에 전달된다.
  // 그 이벤트로 "설정 버튼 위인가"를 판단해 setInteractive를 호출한다.
  win.setIgnoreMouseEvents(clickThroughActive, { forward: true })
}

/**
 * 클릭 통과 중 임시로 마우스를 받는다.
 *
 * 통과를 되돌릴 수단(설정 버튼·설정창)까지 통과시키면 위젯이 영영 안 잡히는 상태가 된다.
 * 그래서 렌더러가 그 영역 위에 마우스가 올라온 순간에만 이걸 켠다.
 */
export function setInteractive(interactive: boolean): void {
  if (!win || win.isDestroyed() || !clickThroughActive) return
  win.setIgnoreMouseEvents(!interactive, { forward: true })
}

/**
 * 작은 위젯(오늘+내일) ↔ 큰 위젯(7일).
 *
 * **좌상단을 고정한 채 크기만 바꾼다.** 모드별로 위치까지 기억하면 펼칠 때
 * 예전에 큰 위젯을 놔뒀던 자리로 창이 점프해서, 지금 보고 있던 위치를 잃는다.
 */
export function applySizeMode(sizeMode: WidgetSizeMode, previous: WidgetSizeMode): void {
  if (!win || win.isDestroyed()) return
  if (sizeMode === previous) return

  // 떠나기 전 현재 크기를 확정해둔다 (디바운스 대기 중일 수 있다).
  if (saveTimer) clearTimeout(saveTimer)
  persistBounds(previous)

  const { x, y } = win.getBounds()
  win.setBounds(clampToDisplay(x, y, sizeFor(sizeMode)))

  setSetting('widgetSizeMode', sizeMode)
  persistBounds(sizeMode)
}

export function createWidgetWindow(): BrowserWindow {
  const settings = getAllSettings()
  const saved = resolveBounds(settings.widgetSizeMode)
  const clear = settings.backgroundEffect === 'clear'
  appliedEffect = settings.backgroundEffect
  appliedScale = settings.uiScale

  win = new BrowserWindow({
    ...(saved ?? DEFAULT_SIZE[settings.widgetSizeMode]),
    show: false,
    frame: false,
    /*
     * 유리 배경은 OS에 맡긴다.
     *
     * `transparent: true` + CSS `backdrop-filter`로는 유리가 되지 않는다 —
     * backdrop-filter가 흐리는 대상은 "페이지 안에서 이 요소 뒤에 그려진 것"이지
     * 창 뒤의 바탕화면이 아니다. 그래서 선명한 바탕화면 위에 어두운 막만 씌워지고,
     * 위젯이 비어 있는 부분(타이틀바 등)에서 벽지가 그대로 비친다.
     *
     * Windows 11의 acrylic 재질은 컴포지터가 창 뒤를 실제로 흐려준다.
     * 단 `transparent: true`와 함께 쓸 수 없으므로 끄고, 배경색을 완전 투명으로 두어
     * 재질이 그대로 보이게 한다.
     */
    // '그대로 비침'은 OS 재질 없이 진짜 투명 창이어야 한다.
    transparent: clear || !USE_ACRYLIC,
    /*
     * 배경색은 어느 모드에서든 완전 투명으로 둔다.
     * 지정하지 않으면 Electron 기본값이 흰색이라, 페이지가 칠하지 않는 영역
     * (비활성 상태에서 Windows가 잡는 캡션 자리 등)에 흰 띠가 남는다.
     */
    backgroundColor: '#00000000',
    ...(USE_ACRYLIC && !clear ? { backgroundMaterial: 'acrylic' as const } : {}),
    skipTaskbar: true,
    icon: appIconPath(),
    /*
     * 창 제목을 비워둔다.
     *
     * 비활성 상태가 되면 Windows가 이 창의 캡션을 그려서, 위젯 위에 시스템 글꼴로 된
     * 제목이 네모난 띠와 함께 겹쳐 보였다 (위젯은 모서리가 둥근데 그 띠는 각졌다).
     * 화면에 보이는 "주간 타임블록"은 HTML 타이틀바가 그리므로 창 제목은 필요 없다.
     * `title: ''`만으로는 페이지 <title>이 덮어쓰므로 setTitle로 한 번 더 지운다.
     */
    title: '',
    // 층은 설정을 따른다 (항상 위 / 바탕화면 위·앱 아래). 아래 applyLayer가 확정한다.
    alwaysOnTop: settings.windowLayer === 'top',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 첫 프레임부터 올바른 배율로 그린다. 나중에 setZoomFactor로 바꾸면
      // 투명 창에 100% 시절의 프레임이 남아 유령 글자가 생긴다.
      zoomFactor: settings.uiScale / 100,
      /*
       * 포커스를 잃어도 계속 그리게 한다.
       *
       * 기본값(true)이면 창이 비활성일 때 Chromium이 렌더링을 늦추거나 멈춘다.
       * 투명 창은 이전 프레임을 지우지 않으므로, 그동안 남아 있던 옛 픽셀
       * (예전 위치·배율의 타이틀바)이 그대로 드러나 밝은 띠와 겹친 글자로 보인다.
       * 항상 위에 떠 있는 위젯은 대부분의 시간이 비활성이라 이 설정이 사실상 필수다.
       */
      backgroundThrottling: false,
    },
  })

  // 가상 데스크톱을 전환해도 따라오게 한다.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applyWidgetMode(
    settings.widgetMode,
    settings.clickThrough,
    settings.uiScale,
    settings.backgroundEffect,
    settings.windowLayer,
  )

  /*
   * `ready-to-show`는 첫 페인트가 끝나야 오는데, 안 오는 경우가 있다.
   * 그러면 위젯이 조용히 영영 안 뜬다 — 트레이 말고는 되살릴 방법이 없어 최악의 실패 모드다.
   * 로드가 끝나면 무조건 한 번 더 띄운다 (이미 보이면 show는 무해하다).
   */
  const reveal = (): void => {
    if (!win || win.isDestroyed() || win.isVisible()) return
    /*
     * 바탕화면 층일 때는 포커스를 뺏지 않고 띄운다.
     * 부팅 자동 실행이라 사용자가 이미 다른 일을 하고 있을 수 있는데,
     * 그때 위젯이 앞으로 튀어나와 포커스를 가져가면 "배경과 한몸"이라는 성격에 어긋난다.
     */
    if (settings.windowLayer === 'desktop') win.showInactive()
    else win.show()
  }
  win.on('ready-to-show', reveal)
  win.webContents.on('did-finish-load', reveal)

  // 페이지의 <title>이 창 제목으로 올라오면 비활성 캡션에 그 글자가 그려진다. 계속 비워둔다.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win?.setTitle('')
  })
  win.setTitle('')

  // 위치 저장을 'moved'/'resized'(끝날 때 한 번)에만 걸면, 그 이벤트가 안 오는 경로
  // (창 관리 도구나 스냅 등 외부에서 옮겨진 경우)에서 조용히 유실된다.
  // 진행 중 이벤트까지 함께 받고 디바운스로 한 번만 쓴다.
  win.on('move', schedulePersist)
  win.on('moved', schedulePersist)
  win.on('resize', schedulePersist)
  win.on('resized', schedulePersist)

  // 상주 위젯이므로 닫기 버튼은 숨기기다. 실제로 닫아버리면 트레이에서 다시 띄울 창이 없어진다.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => {
    win = null
  })

  // 위젯 안의 외부 링크(TODO의 url 등)는 기본 브라우저로 보낸다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 종료 전에 디바운스 대기 중인 위치를 확정한다. */
export function flushWindowState(): void {
  if (saveTimer) clearTimeout(saveTimer)
  if (win && !win.isDestroyed()) persistBounds(getSetting('widgetSizeMode'))
}
