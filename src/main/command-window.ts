import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { getSetting, setSetting } from '@main/db/repositories/settings'
import { getWidgetWindow } from '@main/window'

/**
 * 자연어 명령 입력 창.
 *
 * 위젯 **안**에 드롭다운으로 그리지 않고 별도 창으로 띄운다. 백로그는 위젯 맨 아래에
 * 붙어 있는 스크롤 영역이라, 안에서 펼치면 잘리거나 목록을 가린다. 창으로 띄우면
 * 위젯 경계와 무관하게 늘 같은 자리에 같은 크기로 뜨고, 포커스도 확실히 잡는다.
 *
 * 짧게 쓰고 사라지는 창이지만 **위치는 기억한다** — 매번 다른 자리에 뜨면
 * 눈으로 찾아야 해서 "열고 바로 친다"는 흐름이 끊긴다.
 */

const WIDTH = 420
/** 입력 한 줄 + 안내 한 줄. 렌더러가 이 안에 카드를 그린다 */
const HEIGHT = 96

/** 드래그가 끝난 뒤 한 번만 저장하면 된다 */
const SAVE_DEBOUNCE_MS = 300

let win: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null

/** 저장된 좌표가 지금 연결된 모니터 밖이면 창이 화면 밖에 생겨 영영 못 찾는다. */
function isOnSomeDisplay(r: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y
  })
}

/** 기억해둔 자리, 없으면 위젯 가운데 */
function placement(): { x: number; y: number } {
  const saved = getSetting('commandPosition')
  if (saved && isOnSomeDisplay({ ...saved, width: WIDTH, height: HEIGHT })) return saved

  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const widget = getWidgetWindow()
  const base = widget && !widget.isDestroyed() ? widget.getBounds() : area
  const x = Math.round(base.x + base.width / 2 - WIDTH / 2)
  const y = Math.round(base.y + base.height / 2 - HEIGHT / 2)

  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - WIDTH)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - HEIGHT)),
  }
}

function persistPosition(): void {
  if (!win || win.isDestroyed()) return
  const { x, y } = win.getBounds()
  setSetting('commandPosition', { x, y })
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistPosition, SAVE_DEBOUNCE_MS)
}

export function openCommandWindow(): void {
  if (win && !win.isDestroyed()) {
    win.setBounds({ ...placement(), width: WIDTH, height: HEIGHT })
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    ...placement(),
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    // 지정하지 않으면 Electron 기본값이 흰색이라 카드 바깥 모서리에 흰 띠가 남는다.
    backgroundColor: '#00000000',
    resizable: false,
    // 카드를 끌어서 옮긴다 (렌더러의 -webkit-app-region: drag와 짝).
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 투명 창은 이전 프레임을 지우지 않는다. 렌더링이 멈추면 옛 픽셀이 그대로 드러난다.
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 페이지 <title>이 창 제목으로 올라오면 비활성 캡션에 그 글자가 그려진다.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win?.setTitle('')
  })
  win.setTitle('')

  const reveal = (): void => {
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
  }
  win.on('ready-to-show', reveal)
  win.webContents.on('did-finish-load', reveal)

  // 'moved'만 걸면 창 관리 도구나 스냅처럼 그 이벤트가 안 오는 경로에서 조용히 유실된다.
  win.on('move', schedulePersist)
  win.on('moved', schedulePersist)

  // 다른 곳을 누르면 사라진다. 명령 하나 치고 끝나는 창이라 남겨둘 이유가 없다.
  // (카드를 끄는 동안에는 포커스를 잃지 않으므로 드래그와 부딪히지 않는다)
  win.on('blur', () => closeCommandWindow())
  win.on('closed', () => {
    win = null
  })

  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    void win.loadURL(`${url}?view=command`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'command' } })
  }
}

export function closeCommandWindow(): void {
  // 디바운스 대기 중인 위치를 확정하고 닫는다 — 옮기자마자 닫으면 그 이동이 사라진다.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  persistPosition()

  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
