import { ipcMain } from 'electron'
import {
  IPC,
  IPC_EVENT,
  type DbInfo,
  type HistoryDay,
  type Mutation,
  type ScheduleData,
} from '@shared/ipc-contract'
import type { AppSettings, SettingKey, WidgetSizeMode } from '@shared/settings-schema'
import type { DateStr } from '@shared/types'
import { getLogicalDate } from '@shared/scheduler'
import { getDb, getDbPath } from '@main/db/client'
import { getSchemaVersion, LATEST_VERSION } from '@main/db/migrate'
import { getAllSettings, setSetting } from '@main/db/repositories/settings'
import { listCategories } from '@main/db/repositories/categories'
import { applyMutation } from '@main/db/mutations'
import { loadScheduleData } from '@main/db/schedule-view'
import { listCompletedTodos } from '@main/db/repositories/schedule'

/** 히스토리 조회 상한. 위젯에서 훑어보는 용도라 최근 것만 있으면 된다. */
const HISTORY_LIMIT = 300

/** 저장되는 것만으로는 부족하고 창에 직접 반영해야 하는 설정 */
const WINDOW_SETTING_KEYS = new Set<SettingKey>([
  'widgetMode',
  'clickThrough',
  'uiScale',
  'backgroundEffect',
])
import { seedSampleDay } from '@main/dev-seed'
import { applySizeMode, applyWidgetMode, getWidgetWindow, setInteractive } from '@main/window'
import { closeCommandWindow, openCommandWindow } from '@main/command-window'
import { isLaunchAtLoginEnabled, setLaunchAtLogin } from '@main/autostart'
import { connectGoogle, disconnectGoogle } from '@main/google/auth'
import { setClientCredentials, type ClientCredentials } from '@main/google/credentials'
import { listCalendars } from '@main/google/sync'
import {
  addGoogleEvent,
  getGoogleStatus,
  removeGoogleEvent,
  runSync,
  updateGoogleEvent,
} from '@main/google'
import { setApiKey } from '@main/llm/credentials'
import { getLlmStatus, runCommand } from '@main/llm'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.ping, () => 'pong')

  ipcMain.handle(IPC.dbInfo, (): DbInfo => {
    const db = getDb()
    const { version } = db.prepare('SELECT sqlite_version() AS version').get() as {
      version: string
    }
    const [{ journal_mode: journalMode }] = db.pragma('journal_mode') as [
      { journal_mode: string },
    ]
    const [{ foreign_keys: foreignKeys }] = db.pragma('foreign_keys') as [
      { foreign_keys: number },
    ]
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name)

    return {
      sqliteVersion: version,
      dbPath: getDbPath(),
      journalMode,
      foreignKeys: foreignKeys === 1,
      schemaVersion: getSchemaVersion(db),
      expectedSchemaVersion: LATEST_VERSION,
      tables,
    }
  })

  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings())

  ipcMain.handle(IPC.settingsSet, (_e, key: SettingKey, value: AppSettings[SettingKey]) => {
    // 채널 경계를 넘어온 값은 신뢰하지 않는다. setSetting -> serializeSetting이 검증하고
    // 유효하지 않으면 던지므로, 렌더러의 invoke가 reject된다.
    setSetting(key, value as never)

    /*
     * 창에 직접 반영해야 하는 설정은 여기서 바로 적용한다.
     *
     * 렌더러가 저장한 뒤 따로 applyWindowMode를 부르게 두면, 낙관적 갱신 때문에
     * 저장이 끝나기 전에 호출이 먼저 도착해 메인이 아직 옛 값을 읽는다.
     * (배경 효과를 바꿔도 창은 그대로인 문제가 여기서 나왔다)
     */
    if (WINDOW_SETTING_KEYS.has(key)) {
      const s = getAllSettings()
      applyWidgetMode(s.widgetMode, s.clickThrough, s.uiScale, s.backgroundEffect)
    }
  })

  ipcMain.handle(IPC.categoriesList, () => listCategories())

  ipcMain.handle(IPC.scheduleLoad, (_e, dates: DateStr[]): ScheduleData =>
    loadScheduleData(dates),
  )

  ipcMain.handle(IPC.historyLoad, (): HistoryDay[] => {
    const { dayStartHour } = getAllSettings()
    const byDate = new Map<string, HistoryDay['items']>()

    for (const row of listCompletedTodos(HISTORY_LIMIT)) {
      // 새벽 2시에 체크한 항목은 "어제" 완료다.
      const date = getLogicalDate(new Date(row.completed_at), dayStartHour)
      const item = {
        id: row.id,
        title: row.title,
        categoryId: row.category_id,
        completedAt: row.completed_at,
      }
      const bucket = byDate.get(date)
      if (bucket) bucket.push(item)
      else byDate.set(date, [item])
    }

    return [...byDate.entries()]
      .map(([date, items]) => ({ date, items }))
      .sort((a, b) => b.date.localeCompare(a.date))
  })

  ipcMain.handle(IPC.scheduleMutate, async (_e, m: Mutation) => {
    // 구글 생성·수정만 네트워크를 탄다. 로컬 DB 입구(applyMutation)와 섞지 않는다.
    if (m.type === 'googleEvent.update') return updateGoogleEvent(m.id, m.patch)
    if (m.type === 'googleEvent.create') return addGoogleEvent(m)
    if (m.type === 'googleEvent.delete') return removeGoogleEvent(m.id)
    applyMutation(m)
  })

  ipcMain.handle(IPC.windowApply, () => {
    const s = getAllSettings()
    applyWidgetMode(s.widgetMode, s.clickThrough, s.uiScale, s.backgroundEffect)
  })

  ipcMain.handle(IPC.windowSizeMode, (e, sizeMode: WidgetSizeMode) => {
    // 크기 모드는 창 기하와 묶여 있어 메인이 주인이다.
    // 저장은 여기서 하므로, 렌더러가 낡은 값을 들고 있지 않도록 바뀐 사실을 알려준다.
    applySizeMode(sizeMode, getAllSettings().widgetSizeMode)
    e.sender.send(IPC_EVENT.settingsChanged)
  })

  ipcMain.handle(IPC.windowInteractive, (_e, interactive: boolean) => setInteractive(interactive))
  ipcMain.handle(IPC.launchAtLoginGet, () => isLaunchAtLoginEnabled())
  ipcMain.handle(IPC.launchAtLoginSet, (_e, enabled: boolean) => setLaunchAtLogin(enabled))

  // ── 구글 캘린더 ──────────────────────────────────────────────────────────
  // 시크릿과 토큰은 여기서도 절대 돌려주지 않는다. 상태만 내려간다.
  ipcMain.handle(IPC.googleStatus, () => getGoogleStatus())

  ipcMain.handle(IPC.googleSetClient, (_e, creds: ClientCredentials | null) =>
    setClientCredentials(creds),
  )

  ipcMain.handle(IPC.googleConnect, () => connectGoogle())
  ipcMain.handle(IPC.googleDisconnect, () => disconnectGoogle())
  ipcMain.handle(IPC.googleListCalendars, () => listCalendars())
  ipcMain.handle(IPC.googleSyncNow, () => runSync())

  // ── 자연어 명령 (LLM) ───────────────────────────────────────────────────
  // API 키는 여기서도 절대 돌려주지 않는다. 있는지 여부와 꼬리 4자만 내려간다.
  ipcMain.handle(IPC.llmStatus, () => getLlmStatus())
  ipcMain.handle(IPC.llmSetKey, (_e, key: string | null) => setApiKey(key))

  ipcMain.handle(IPC.llmRun, async (_e, text: string) => {
    const result = await runCommand(text)
    /*
     * 도구가 DB를 건드렸으면 화면이 낡은 값을 들고 있다. 다시 읽게 한다.
     * 보낸 쪽(e.sender)이 아니라 **위젯 창**에 보내야 한다 — 명령은 별도 창에서 오므로
     * e.sender로 보내면 정작 갱신해야 할 위젯은 그대로 남는다.
     */
    if (result.actions.length > 0) {
      getWidgetWindow()?.webContents.send(IPC_EVENT.settingsChanged)
    }
    return result
  })

  ipcMain.handle(IPC.commandOpen, () => openCommandWindow())
  ipcMain.handle(IPC.commandClose, () => closeCommandWindow())

  ipcMain.handle(IPC.devSeed, () => {
    seedSampleDay(getLogicalDate(new Date(), getAllSettings().dayStartHour))
  })
}
