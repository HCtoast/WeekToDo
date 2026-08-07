import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { migrate } from '@main/db/migrate'

let db: Database.Database | null = null

/** DB 파일 경로. userData 아래에 두어 앱 업데이트와 무관하게 유지된다. */
export function getDbPath(): string {
  return join(app.getPath('userData'), 'app.db')
}

/**
 * 프로세스당 단일 커넥션.
 * better-sqlite3는 동기 API이며 메인 프로세스에서만 사용한다 (렌더러에서 직접 import 금지).
 */
export function getDb(): Database.Database {
  if (db) return db

  db = new Database(getDbPath())
  // WAL: 읽기(렌더 조회)와 쓰기가 서로 막지 않게 한다.
  db.pragma('journal_mode = WAL')
  // 기본이 OFF라 명시적으로 켜야 REFERENCES가 실제로 강제된다.
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
