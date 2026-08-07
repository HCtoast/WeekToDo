import { app } from 'electron'
import { ANCHOR_SNAP_MINUTES } from '@shared/constants'
import { getLogicalDate, snapUpToUnit } from '@shared/scheduler'
import { getSetting, setSetting } from '@main/db/repositories/settings'
import { setAnchorIfAbsent } from '@main/db/repositories/schedule'

/**
 * 시작앱으로 자동 실행됐는지 판별하는 표식.
 *
 * Windows에는 macOS의 `wasOpenedAtLogin`이 없다. 그래서 로그인 항목을 등록할 때
 * 인자를 직접 심어두고 실행 시 `process.argv`에서 찾는다.
 */
const AUTOSTART_FLAG = '--autostart'

/**
 * 등록에 쓸 실행 파일과 인자.
 *
 * 개발 중에는 `process.execPath`가 `node_modules/electron/dist/electron.exe`라,
 * 앱 경로를 인자로 함께 넘기지 않으면 시작 시 **빈 Electron 창**이 뜬다.
 * 조회(`getLoginItemSettings`)도 등록할 때와 **같은 path/args**를 줘야 우리가 만든
 * 항목을 찾는다 — 다르면 켜 놓고도 계속 "꺼짐"으로 보인다.
 */
function loginItemOptions(): { path: string; args: string[] } {
  return {
    path: process.execPath,
    args: app.isPackaged ? [AUTOSTART_FLAG] : [app.getAppPath(), AUTOSTART_FLAG],
  }
}

export function isLaunchAtLoginEnabled(): boolean {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin
}

/**
 * 이 실행 파일로 등록된 항목의 레지스트리 값 이름.
 *
 * `launchItems`는 **지금 실행 중인 실행 파일과 경로가 같은 항목만** 돌려준다.
 * 그래서 여기서 찾은 것은 곧 우리 것이고, 반대로 **다른 빌드가 만든 항목은 절대 안 보인다** —
 * 설치본에서 개발용 항목을 지우려면 이름을 미리 기억해두는 수밖에 없다 (`rememberItem`).
 */
function currentItemName(): string | null {
  const items = app.getLoginItemSettings().launchItems ?? []
  return items.find((i) => i.path === process.execPath)?.name ?? null
}

/** 지금 빌드가 만든 항목의 이름을 설정에 남긴다. 나중에 다른 빌드가 이걸 보고 지운다. */
function rememberItem(): void {
  const name = currentItemName()
  if (name === null) return

  const others = getSetting('launchAtLoginItems').filter((i) => i.path !== process.execPath)
  setSetting('launchAtLoginItems', [...others, { name, path: process.execPath }])
}

/**
 * 다른 빌드가 남긴 시작 항목을 지운다 (개발 → 설치본으로 넘어갈 때).
 *
 * 레지스트리 값 이름은 앱 이름에서 나오므로 개발(`electron.app.Electron`)과 설치본이
 * 서로 다르다. 그냥 두면 부팅 때 **둘 다 뜬다**.
 */
function forgetOtherBuilds(): void {
  const items = getSetting('launchAtLoginItems')
  const stale = items.filter((i) => i.path !== process.execPath)
  if (stale.length === 0) return

  for (const item of stale) app.setLoginItemSettings({ openAtLogin: false, name: item.name })
  setSetting(
    'launchAtLoginItems',
    items.filter((i) => i.path === process.execPath),
  )
}

export function setLaunchAtLogin(enabled: boolean): void {
  forgetOtherBuilds()
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() })
  // 사용자의 뜻은 레지스트리가 아니라 여기에 남긴다 — 실행 파일이 바뀌면 레지스트리는
  // "꺼짐"으로 보이는데, 그걸 사용자가 끈 것으로 오해하면 안 된다.
  setSetting('launchAtLoginEnabled', enabled)

  if (enabled) rememberItem()
  else
    setSetting(
      'launchAtLoginItems',
      getSetting('launchAtLoginItems').filter((i) => i.path !== process.execPath),
    )
}

/**
 * 켜져 있어야 할 상태를 실제 레지스트리에 맞춘다. 매 실행마다 부른다.
 *
 * 상주 위젯이라 기본은 켜짐이다(`launchAtLoginEnabled`의 기본값). 사용자가 설정에서 끄면
 * 그 뜻이 저장되어 다시 켜지지 않는다.
 *
 * 설치본을 처음 실행하면 레지스트리에는 개발 빌드 항목만 있어 "꺼짐"으로 보이는데,
 * 저장된 뜻이 "켜짐"이므로 여기서 설치본으로 옮겨오고 개발 항목은 지운다.
 */
export function ensureLaunchAtLoginRegistered(): boolean {
  if (!getSetting('launchAtLoginEnabled')) {
    forgetOtherBuilds()
    return false
  }

  if (isLaunchAtLoginEnabled()) {
    // 이미 맞다. 이름만 최신으로 기억해두고 다른 빌드의 흔적을 치운다.
    forgetOtherBuilds()
    rememberItem()
    return false
  }

  setLaunchAtLogin(true)
  return true
}

export function wasAutoStarted(): boolean {
  return process.argv.includes(AUTOSTART_FLAG)
}

/**
 * 부팅 후 시작앱으로 자동 실행된 시각을 30분 단위로 올려 그날 앵커로 기록한다 (06:40 → 07:00).
 * 요일 고정값보다 "실제로 책상 앞에 앉은 시각"에 가까우므로 더 나은 추정치다.
 *
 * 다음 경우에는 아무것도 하지 않는다.
 * - 사용자가 손으로 켠 실행 (`--autostart` 없음)
 * - 그날 앵커 행이 이미 있는 경우 → 하루에 여러 번 재부팅해도 첫 실행만 반영된다
 * - 설정에서 껐을 때
 *
 * 새벽 재부팅은 `getLogicalDate`를 거치므로 아직 "어제"로 판정되어 어제 앵커를 건드리지 않는다.
 */
export function recordAutostartAnchor(now = new Date()): { date: string; time: string } | null {
  if (!wasAutoStarted() || !getSetting('autoAnchorOnLaunch')) return null

  const date = getLogicalDate(now, getSetting('dayStartHour'))
  const time = snapUpToUnit(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    ANCHOR_SNAP_MINUTES,
  )

  return setAnchorIfAbsent(date, time) ? { date, time } : null
}
