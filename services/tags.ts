/**
 * Tags Service
 *
 * CRUD for user-defined tags that can be attached to expenses.
 * Many-to-many relationship via expense_tags join table.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export const TAG_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
  "#6366F1", // indigo
  "#84CC16", // lime
];

/**
 * Get all tags for a user, ordered by name.
 */
export async function getTags(userId: string): Promise<Tag[]> {
  const db = getDatabase();
  return db.getAllAsync<Tag>(
    `SELECT * FROM tags WHERE user_id = ? ORDER BY name;`,
    userId,
  );
}

/**
 * Get all tags attached to a specific expense.
 */
export async function getTagsForExpense(expenseId: string): Promise<Tag[]> {
  const db = getDatabase();
  return db.getAllAsync<Tag>(
    `SELECT t.* FROM tags t
     INNER JOIN expense_tags et ON et.tag_id = t.id
     WHERE et.expense_id = ?
     ORDER BY t.name;`,
    expenseId,
  );
}

/**
 * Batch-load tags for multiple expenses in a single query.
 * Returns a map from expense_id → Tag[].
 */
export async function getTagsForExpenses(
  expenseIds: string[],
): Promise<Record<string, Tag[]>> {
  const result: Record<string, Tag[]> = {};
  if (expenseIds.length === 0) return result;

  const db = getDatabase();
  const placeholders = expenseIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<Tag & { expense_id: string }>(
    `SELECT t.*, et.expense_id FROM tags t
     INNER JOIN expense_tags et ON et.tag_id = t.id
     WHERE et.expense_id IN (${placeholders})
     ORDER BY t.name;`,
    ...expenseIds,
  );

  for (const id of expenseIds) {
    result[id] = [];
  }
  for (const row of rows) {
    const eid = row.expense_id;
    if (!result[eid]) result[eid] = [];
    result[eid].push({ id: row.id, user_id: row.user_id, name: row.name, color: row.color, created_at: row.created_at });
  }
  return result;
}

/**
 * Create a new tag. Auto-assigns a color if not specified.
 */
export async function createTag(
  userId: string,
  name: string,
  color?: string,
): Promise<Tag> {
  const db = getDatabase();
  const id = generateUUID();

  // Pick color: use provided, or round-robin based on existing tag count
  let tagColor = color;
  if (!tagColor) {
    const countRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM tags WHERE user_id = ?;`,
      userId,
    );
    const idx = (countRow?.count ?? 0) % TAG_COLORS.length;
    tagColor = TAG_COLORS[idx];
  }

  await db.runAsync(
    `INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?);`,
    id,
    userId,
    name.trim(),
    tagColor,
  );

  bumpDataVersion();
  return {
    id,
    user_id: userId,
    name: name.trim(),
    color: tagColor,
    created_at: new Date().toISOString(),
  };
}

/**
 * Find a tag by name (case-insensitive), or create it if it doesn't exist.
 */
export async function findOrCreateTag(
  userId: string,
  name: string,
): Promise<Tag> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<Tag>(
    `SELECT * FROM tags WHERE user_id = ? AND LOWER(name) = LOWER(?);`,
    userId,
    name.trim(),
  );

  if (existing) return existing;
  return createTag(userId, name);
}

/**
 * Add a tag to an expense. No-op if already tagged.
 */
export async function addTagToExpense(
  expenseId: string,
  tagId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO expense_tags (expense_id, tag_id) VALUES (?, ?);`,
    expenseId,
    tagId,
  );
}

/**
 * v17.5.3 — batch-add multiple tags to an expense in one multi-row INSERT.
 * Replaces the N serial INSERTs the add-expense / edit-expense flows did
 * via a tagId loop.
 */
export async function addTagsToExpense(
  expenseId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const db = getDatabase();
  const placeholders = tagIds.map(() => "(?, ?)").join(", ");
  const values: string[] = [];
  for (const tagId of tagIds) {
    values.push(expenseId, tagId);
  }
  await db.runAsync(
    `INSERT OR IGNORE INTO expense_tags (expense_id, tag_id) VALUES ${placeholders};`,
    ...values,
  );
}

/**
 * Remove a tag from an expense.
 */
export async function removeTagFromExpense(
  expenseId: string,
  tagId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM expense_tags WHERE expense_id = ? AND tag_id = ?;`,
    expenseId,
    tagId,
  );
}

/**
 * Delete a tag entirely. Cascade removes all expense_tags links.
 */
export async function deleteTag(tagId: string): Promise<void> {
  const db = getDatabase();
  // Manually delete join rows first (SQLite cascade may need PRAGMA foreign_keys=ON)
  await db.runAsync(`DELETE FROM expense_tags WHERE tag_id = ?;`, tagId);
  await db.runAsync(`DELETE FROM tags WHERE id = ?;`, tagId);
  bumpDataVersion();
}

/**
 * Update tag name and/or color.
 */
export async function updateTag(
  tagId: string,
  updates: { name?: string; color?: string },
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name.trim());
  }
  if (updates.color !== undefined) {
    fields.push("color = ?");
    values.push(updates.color);
  }

  if (fields.length === 0) return;

  values.push(tagId);
  await db.runAsync(
    `UPDATE tags SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

/**
 * Get the number of expenses using a specific tag.
 */
export async function getTagUsageCount(tagId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM expense_tags WHERE tag_id = ?;`,
    tagId,
  );
  return row?.count ?? 0;
}
