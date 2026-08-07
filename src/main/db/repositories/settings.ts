import {
  DEFAULT_SETTINGS,
  parseSetting,
  resolveSettings,
  serializeSetting,
  type AppSettings,
  type SettingKey,
} from '@shared/settings-schema'
import { getDb } from '@main/db/client'

/**
 * settings 테이블은 기본값에서 벗어난 값만 담는다.
 * 따라서 "행이 없다 = 기본값"이며, 읽기는 항상 기본값 위에 override를 얹는 방식이다.
 */

export function getAllSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  return resolveSettings(rows)
}

export function getSetting<K extends SettingKey>(key: K): AppSettings[K] {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return parseSetting(key, row?.value ?? null)
}

export function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): void {
  // 기본값과 같아지면 행을 지운다 — 그래야 나중에 기본값이 바뀔 때 따라온다.
  if (JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[key])) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }

  // serializeSetting이 유효성을 검사한다 — 잘못된 값은 여기서 막힌다.
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, serializeSetting(key, value))
}
