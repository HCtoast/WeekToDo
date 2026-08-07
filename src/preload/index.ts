import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_EVENT,
  type Api,
  type CommandResult,
  type DbInfo,
  type GoogleCalendarInfo,
  type GoogleStatus,
  type HistoryDay,
  type LlmStatus,
  type Mutation,
  type ScheduleData,
} from '@shared/ipc-contract'
import type { AppSettings, SettingKey, WidgetSizeMode } from '@shared/settings-schema'
import type { CategoryRow, DateStr } from '@shared/types'

function subscribe(channel: string, handler: () => void): () => void {
  const listener = (): void => handler()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

/**
 * 렌더러가 메인에 닿는 유일한 통로.
 * 여기 노출되지 않은 기능은 렌더러에서 쓸 수 없다 (fs / better-sqlite3 / googleapis 직접 접근 금지).
 */
const api: Api = {
  ping: () => ipcRenderer.invoke(IPC.ping) as Promise<string>,
  dbInfo: () => ipcRenderer.invoke(IPC.dbInfo) as Promise<DbInfo>,
  getSettings: () => ipcRenderer.invoke(IPC.settingsGetAll) as Promise<AppSettings>,
  setSetting: <K extends SettingKey>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke(IPC.settingsSet, key, value) as Promise<void>,
  listCategories: () => ipcRenderer.invoke(IPC.categoriesList) as Promise<CategoryRow[]>,
  loadSchedule: (dates: DateStr[]) =>
    ipcRenderer.invoke(IPC.scheduleLoad, dates) as Promise<ScheduleData>,
  loadHistory: () => ipcRenderer.invoke(IPC.historyLoad) as Promise<HistoryDay[]>,
  mutate: (mutation: Mutation) =>
    ipcRenderer.invoke(IPC.scheduleMutate, mutation) as Promise<void>,
  applyWindowMode: () => ipcRenderer.invoke(IPC.windowApply) as Promise<void>,
  setSizeMode: (sizeMode: WidgetSizeMode) =>
    ipcRenderer.invoke(IPC.windowSizeMode, sizeMode) as Promise<void>,
  setInteractive: (interactive: boolean) =>
    ipcRenderer.invoke(IPC.windowInteractive, interactive) as Promise<void>,
  isLaunchAtLogin: () => ipcRenderer.invoke(IPC.launchAtLoginGet) as Promise<boolean>,
  setLaunchAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.launchAtLoginSet, enabled) as Promise<void>,

  googleStatus: () => ipcRenderer.invoke(IPC.googleStatus) as Promise<GoogleStatus>,
  googleSetClient: (creds: { clientId: string; clientSecret: string } | null) =>
    ipcRenderer.invoke(IPC.googleSetClient, creds) as Promise<void>,
  googleConnect: () => ipcRenderer.invoke(IPC.googleConnect) as Promise<{ account: string }>,
  googleDisconnect: () => ipcRenderer.invoke(IPC.googleDisconnect) as Promise<void>,
  googleListCalendars: () =>
    ipcRenderer.invoke(IPC.googleListCalendars) as Promise<GoogleCalendarInfo[]>,
  googleSyncNow: () => ipcRenderer.invoke(IPC.googleSyncNow) as Promise<{ events: number }>,

  llmStatus: () => ipcRenderer.invoke(IPC.llmStatus) as Promise<LlmStatus>,
  llmSetKey: (key: string | null) => ipcRenderer.invoke(IPC.llmSetKey, key) as Promise<void>,
  llmRun: (text: string) => ipcRenderer.invoke(IPC.llmRun, text) as Promise<CommandResult>,
  openCommandWindow: () => ipcRenderer.invoke(IPC.commandOpen) as Promise<void>,
  closeCommandWindow: () => ipcRenderer.invoke(IPC.commandClose) as Promise<void>,

  // 이벤트 인자를 그대로 넘기지 않는다 — 렌더러에 IpcRendererEvent를 노출할 이유가 없다.
  onSettingsChanged: (handler: () => void) => subscribe(IPC_EVENT.settingsChanged, handler),
  onOpenSettings: (handler: () => void) => subscribe(IPC_EVENT.settingsOpen, handler),

  seedSample: () => ipcRenderer.invoke(IPC.devSeed) as Promise<void>,
}

contextBridge.exposeInMainWorld('api', api)
