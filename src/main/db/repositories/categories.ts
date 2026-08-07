import { randomUUID } from 'node:crypto'
import type { CategoryRow } from '@shared/types'
import { getDb } from '@main/db/client'

/** 시드 카테고리 id. 코드에서 참조해야 하는 것만 상수로 둔다. */
export const CATEGORY_ETC = 'cat-etc'

export function listCategories(): CategoryRow[] {
  return getDb()
    .prepare('SELECT * FROM categories ORDER BY priority, name')
    .all() as CategoryRow[]
}

export function getCategory(id: string): CategoryRow | undefined {
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as
    | CategoryRow
    | undefined
}

export function createCategory(input: {
  name: string
  baseColor: string
  priority: number
  completable?: boolean
}): CategoryRow {
  const row: CategoryRow = {
    id: randomUUID(),
    name: input.name,
    base_color: input.baseColor,
    priority: input.priority,
    completable: input.completable ? 1 : 0,
    created_at: new Date().toISOString(),
  }

  getDb()
    .prepare(
      `INSERT INTO categories (id, name, base_color, priority, completable, created_at)
       VALUES (@id, @name, @base_color, @priority, @completable, @created_at)`,
    )
    .run(row)

  return row
}

export function updateCategory(
  id: string,
  patch: Partial<Pick<CategoryRow, 'name' | 'base_color' | 'priority' | 'completable'>>,
): void {
  const fields = Object.keys(patch)
  if (fields.length === 0) return

  // 키는 위 Pick 타입으로 제한되므로 문자열 조합이 안전하다.
  const assignments = fields.map((f) => `${f} = @${f}`).join(', ')
  getDb()
    .prepare(`UPDATE categories SET ${assignments} WHERE id = @id`)
    .run({ ...patch, id })
}

/**
 * 카테고리를 지워도 항목은 지우지 않는다 (FK가 ON DELETE SET NULL).
 * 데이터를 삭제하지 않는다는 원칙에 따라 TODO/이벤트는 미분류로 남는다.
 */
export function deleteCategory(id: string): void {
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
}
