import type { Database } from 'better-sqlite3'
import init001 from './migrations/001_init.sql?raw'
import googleAllDay002 from './migrations/002_google_all_day.sql?raw'
import categoryPalette003 from './migrations/003_category_palette.sql?raw'
import googleColors004 from './migrations/004_google_colors.sql?raw'

interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * 순번은 고정이다. 이미 적용된 마이그레이션의 SQL은 수정하지 않고 새 항목을 추가한다.
 * (수정하면 기존 사용자의 DB만 조용히 다른 모양이 된다)
 */
const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_init', sql: init001 },
  { version: 2, name: '002_google_all_day', sql: googleAllDay002 },
  { version: 3, name: '003_category_palette', sql: categoryPalette003 },
  { version: 4, name: '004_google_colors', sql: googleColors004 },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

export function getSchemaVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * user_version PRAGMA로 적용 여부를 추적한다.
 * 각 마이그레이션은 트랜잭션 하나로 적용되므로, 중간에 실패하면 그 마이그레이션은 통째로 롤백된다.
 */
export function migrate(db: Database): { from: number; to: number; applied: string[] } {
  const from = getSchemaVersion(db)
  const applied: string[] = []

  for (const m of MIGRATIONS) {
    if (m.version <= from) continue

    const run = db.transaction(() => {
      db.exec(m.sql)
      // PRAGMA는 바인딩을 받지 않는다. version은 위 상수 배열에서 온 값이라 안전.
      db.pragma(`user_version = ${m.version}`)
    })

    try {
      run()
    } catch (cause) {
      throw new Error(`마이그레이션 실패: ${m.name}`, { cause })
    }
    applied.push(m.name)
  }

  return { from, to: getSchemaVersion(db), applied }
}
