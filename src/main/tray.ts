import { app, Menu, Tray, nativeImage } from 'electron'
import { getSetting, setSetting } from '@main/db/repositories/settings'
import { applySizeMode, getWidgetWindow } from '@main/window'
import { isLaunchAtLoginEnabled, setLaunchAtLogin } from '@main/autostart'
import { trayIconPath } from '@main/resources'

let tray: Tray | null = null

export function createTray(onOpenSettings: () => void): void {
  tray = new Tray(nativeImage.createFromPath(trayIconPath()))
  tray.setToolTip('주간 타임블록')
  refreshTrayMenu(onOpenSettings)

  // 트레이를 누르면 위젯을 앞으로 가져온다 (숨겨져 있으면 다시 보인다).
  tray.on('click', () => {
    const win = getWidgetWindow()
    if (!win) return
    win.show()
    win.focus()
  })
}

export function refreshTrayMenu(onOpenSettings: () => void): void {
  if (!tray) return

  const sizeMode = getSetting('widgetSizeMode')
  const widgetMode = getSetting('widgetMode')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: sizeMode === 'small' ? '펼치기 (7일)' : '접기 (오늘+내일)',
        click: () => {
          applySizeMode(sizeMode === 'small' ? 'large' : 'small', sizeMode)
          refreshTrayMenu(onOpenSettings)
        },
      },
      {
        label: '이동 모드',
        type: 'checkbox',
        checked: widgetMode === 'move',
        click: () => {
          setSetting('widgetMode', widgetMode === 'move' ? 'fixed' : 'move')
          // 창 적용은 렌더러가 설정을 다시 읽고 IPC로 요청한다 —
          // 여기서 직접 적용하면 화면의 자물쇠 아이콘과 어긋난다.
          getWidgetWindow()?.webContents.send('settings:changed')
          refreshTrayMenu(onOpenSettings)
        },
      },
      { type: 'separator' },
      {
        label: '시작 시 자동 실행',
        type: 'checkbox',
        checked: isLaunchAtLoginEnabled(),
        click: (item) => setLaunchAtLogin(item.checked),
      },
      { label: '설정…', click: onOpenSettings },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]),
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
