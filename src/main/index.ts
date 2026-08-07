import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, nativeTheme } from 'electron'
import { getLogicalDate } from '@shared/scheduler'
import { IPC_EVENT } from '@shared/ipc-contract'
import { createWidgetWindow, flushWindowState, getWidgetWindow, markQuitting } from '@main/window'
import { registerIpcHandlers } from '@main/ipc/handlers'
import { closeDb, getDb } from '@main/db/client'
import { getAllSettings } from '@main/db/repositories/settings'
import { ensureLaunchAtLoginRegistered, recordAutostartAnchor } from '@main/autostart'
import { createTray, destroyTray } from '@main/tray'
import { runRollover } from '@main/jobs/rollover'
import { startDayBoundaryJob, stopDayBoundaryJob } from '@main/jobs/day-boundary'
import { startGoogleSync, stopGoogleSync } from '@main/google'
import { seedSampleDay } from '@main/dev-seed'

/*
 * 데이터 폴더를 이름에 기대지 않고 못 박는다.
 *
 * `userData` 기본값은 `app.getName()`에서 나오는데, 그 이름은 개발(package.json의 name)과
 * 설치본(productName)에서 달라질 수 있다. 그대로 두면 앱을 패키징한 순간 DB·구글 토큰·API 키가
 * 전부 다른 폴더를 보게 되어 **사용자 데이터가 통째로 사라진 것처럼 보인다.**
 * 반드시 `app.whenReady()` 전에 정해야 한다.
 */
app.setPath('userData', join(app.getPath('appData'), 'weektodo-widget'))

// 위젯은 하나만 떠야 한다. 두 번째 실행은 기존 창을 띄우고 종료.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getWidgetWindow()
    win?.show()
    win?.focus()
  })

  void app.whenReady().then(() => {
    /*
     * 창 테두리·캡션을 어두운 팔레트로 그리게 한다.
     *
     * `frame: false`여도 Windows는 창 위쪽에 캡션을 그리는데, 시스템이 밝은 테마면
     * 그 밝은 띠가 반투명한 타이틀바 밑에서 그대로 비쳐 보인다
     * (측정: 캡션 자리 rgb 98,104,114 vs 위젯 본문 17,19,26).
     * 어두운 테마로 고정하면 위젯 색과 섞여 눈에 띄지 않는다.
     */
    nativeTheme.themeSource = 'dark'

    // DB를 먼저 연다 — 여기서 실패하면 네이티브 모듈 리빌드 문제이므로 창을 띄우기 전에 드러나야 한다.
    getDb()

    // 개발용: 창을 띄우기 전에 샘플 데이터를 넣는다.
    if (process.argv.includes('--seed')) {
      seedSampleDay(getLogicalDate(new Date(), getAllSettings().dayStartHour))
    }

    // 상주 위젯이라 부팅과 함께 뜨는 것이 기본 상태다. 첫 실행에 한 번만 등록하고,
    // 그 뒤로는 설정에서 끈 것을 되살리지 않는다.
    ensureLaunchAtLoginRegistered()

    // 부팅 자동 실행이면 그 시각을 앵커로 남긴다. 창을 만들기 전에 해야
    // 첫 렌더링부터 올바른 앵커가 반영된다.
    recordAutostartAnchor()

    // 앱이 꺼져 있던 사이에 넘어간 날짜들을 여기서 한 번에 따라잡는다.
    // 앵커를 먼저 기록해야 이월분이 오늘의 올바른 앵커에 붙는다.
    runRollover()

    registerIpcHandlers()
    createWidgetWindow()
    // 트레이의 "설정…"은 클릭 통과로 위젯을 못 만질 때의 확실한 탈출구다.
    // 창이 숨어 있을 수도 있으니 반드시 먼저 띄운다.
    createTray(() => {
      const w = getWidgetWindow()
      w?.show()
      w?.webContents.send(IPC_EVENT.settingsOpen)
    })

    // 실행 중에 날짜가 바뀌면 이월하고 화면을 새로 그리게 한다.
    startDayBoundaryJob(() => getWidgetWindow()?.webContents.send(IPC_EVENT.settingsChanged))

    // 구글 캘린더 주기 동기화. 연결돼 있지 않으면 아무 일도 하지 않는다.
    startGoogleSync(() => getWidgetWindow()?.webContents.send(IPC_EVENT.settingsChanged))

    // 프레임이 없어 메뉴가 없으므로 개발자 도구는 단축키로 연다.
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      getWidgetWindow()?.webContents.toggleDevTools()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWidgetWindow()
    })
  })

  // 상주 위젯이므로 창을 닫아도 종료하지 않는다 — 트레이에서 다시 띄운다.
  app.on('window-all-closed', () => {})

  app.on('before-quit', markQuitting)

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopDayBoundaryJob()
    stopGoogleSync()
    flushWindowState()
    destroyTray()
    closeDb()
  })
}
