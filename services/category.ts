import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { DEFAULT_CATEGORIES } from "@/database/defaults/categories";
import { bumpDataVersion } from "@/services/settings";

export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_active: number;
  is_unavoidable: number;
}

export interface CreateCategoryInput {
  user_id: string;
  name: string;
  icon?: string;
  color?: string;
  is_unavoidable?: 0 | 1;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  is_active?: number;
  is_unavoidable?: 0 | 1;
}

/**
 * Get all active categories for a user, ordered by sort_order.
 */
export async function getCategories(userId: string): Promise<Category[]> {
  const db = getDatabase();
  return db.getAllAsync<Category>(
    "SELECT * FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order ASC;",
    userId,
  );
}

/**
 * Get all categories for a user (including inactive), ordered by sort_order.
 */
export async function getAllCategories(userId: string): Promise<Category[]> {
  const db = getDatabase();
  return db.getAllAsync<Category>(
    "SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC;",
    userId,
  );
}

/**
 * Get a single category by ID.
 */
export async function getCategoryById(id: string): Promise<Category | null> {
  const db = getDatabase();
  return db.getFirstAsync<Category>(
    "SELECT * FROM categories WHERE id = ?;",
    id,
  );
}

/**
 * Create a new category. Returns the new category's ID.
 */
export async function createCategory(
  input: CreateCategoryInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  // Get the next sort_order
  const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
    "SELECT MAX(sort_order) as max_order FROM categories WHERE user_id = ?;",
    input.user_id,
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await db.runAsync(
    `INSERT INTO categories (id, user_id, name, icon, color, sort_order, is_unavoidable)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.user_id,
    input.name,
    input.icon ?? "ellipsis-horizontal-circle-outline",
    input.color ?? "#6B7280",
    sortOrder,
    input.is_unavoidable ?? 0,
  );

  bumpDataVersion();
  return id;
}

/**
 * Update a category by ID.
 */
export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.icon !== undefined) {
    fields.push("icon = ?");
    values.push(input.icon);
  }
  if (input.color !== undefined) {
    fields.push("color = ?");
    values.push(input.color);
  }
  if (input.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(input.sort_order);
  }
  if (input.is_active !== undefined) {
    fields.push("is_active = ?");
    values.push(input.is_active);
  }
  if (input.is_unavoidable !== undefined) {
    fields.push("is_unavoidable = ?");
    values.push(input.is_unavoidable);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.runAsync(
    `UPDATE categories SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

/**
 * Soft-delete a category (set is_active = 0).
 * Returns the count of expenses linked to this category.
 */
export async function deleteCategory(id: string): Promise<number> {
  const db = getDatabase();

  // Count only realized expenses for the user-facing message (matches what they
  // see in expense lists). Credits/forecasts are not surfaced here.
  const countRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expenses WHERE category_id = ? AND nature = 'realized' AND deleted_at IS NULL;",
    id,
  );
  const linkedExpenses = countRow?.count ?? 0;

  await db.runAsync(
    "UPDATE categories SET is_active = 0 WHERE id = ?;",
    id,
  );

  bumpDataVersion();
  return linkedExpenses;
}

/**
 * Get all inactive (soft-deleted) categories for the recycle bin.
 */
export async function getInactiveCategories(userId: string): Promise<Category[]> {
  const db = getDatabase();
  return db.getAllAsync<Category>(
    "SELECT * FROM categories WHERE user_id = ? AND is_active = 0 ORDER BY name ASC;",
    userId,
  );
}

/**
 * Restore a soft-deleted category (set is_active = 1).
 */
export async function restoreCategory(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("UPDATE categories SET is_active = 1 WHERE id = ?;", id);
  bumpDataVersion();
}

/**
 * Restore all inactive categories for a user.
 */
export async function restoreAllCategories(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE categories SET is_active = 1 WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Hard-delete all inactive categories for a user (where no expenses are linked).
 */
export async function purgeAllInactiveCategories(userId: string): Promise<number> {
  const db = getDatabase();
  // Get inactive categories with no linked expenses
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM categories c
     WHERE c.user_id = ? AND c.is_active = 0
       AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = c.id AND e.deleted_at IS NULL);`,
    userId,
  );
  let deleted = 0;
  for (const row of rows) {
    const ok = await hardDeleteCategory(row.id);
    if (ok) deleted++;
  }
  return deleted;
}

/**
 * Hard-delete a category permanently.
 * Only allowed when no expenses are linked. Returns true if deleted.
 *
 * FK references cleared:
 *   budgets.category_id (NOT NULL → delete rows)
 *   unavoidable_baselines.category_id (NOT NULL → delete rows)
 *   merchant_corrections.category_id (NOT NULL → delete rows)
 *   merchant_aliases.category_id (nullable → set NULL)
 *   recurring_transactions.category_id (nullable → set NULL)
 *   hisaab_entries.category_id (nullable → set NULL)
 */
export async function hardDeleteCategory(id: string): Promise<boolean> {
  const db = getDatabase();

  // Check ALL linked rows (expenses + credits + forecasts), not just realized
  // expenses — any linked row would cause FK constraint failure on DELETE.
  const count = await getCategoryLinkedRowCount(id);
  if (count > 0) return false;

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM budgets WHERE category_id = ?;", id);
    await db.runAsync("DELETE FROM unavoidable_baselines WHERE category_id = ?;", id);
    await db.runAsync("DELETE FROM merchant_corrections WHERE category_id = ?;", id);
    await db.runAsync("UPDATE merchant_aliases SET category_id = NULL WHERE category_id = ?;", id);
    await db.runAsync("UPDATE recurring_transactions SET category_id = NULL WHERE category_id = ?;", id);
    await db.runAsync("UPDATE hisaab_entries SET category_id = NULL WHERE category_id = ?;", id);
    await db.runAsync("DELETE FROM categories WHERE id = ?;", id);
  });

  bumpDataVersion();
  return true;
}

/**
 * Get the count of expense rows (realized debits only) linked to a category.
 * Used for user-facing "X expenses linked" messages. Excludes credits and
 * forecasts so the count matches what the user sees in expense lists.
 */
export async function getCategoryExpenseCount(id: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expenses WHERE category_id = ? AND nature = 'realized' AND deleted_at IS NULL;",
    id,
  );
  return row?.count ?? 0;
}

/**
 * Get the total count of ALL rows (expenses + credits + forecasts) linked to a
 * category. Used to guard hard-delete — a category with any linked rows (of
 * any nature) cannot be purged without breaking FK integrity.
 */
export async function getCategoryLinkedRowCount(id: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expenses WHERE category_id = ? AND deleted_at IS NULL;",
    id,
  );
  return row?.count ?? 0;
}

/**
 * Swap sort_order between two categories.
 */
export async function swapCategoryOrder(
  id1: string,
  order1: number,
  id2: string,
  order2: number,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE categories SET sort_order = ? WHERE id = ?;",
    order2,
    id1,
  );
  await db.runAsync(
    "UPDATE categories SET sort_order = ? WHERE id = ?;",
    order1,
    id2,
  );
}

/**
 * Seed the default categories for a user.
 * Only seeds if the user has no categories yet.
 * Returns the number of categories seeded.
 */
export async function seedDefaultCategories(userId: string): Promise<number> {
  const db = getDatabase();

  const existing = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM categories WHERE user_id = ?;",
    userId,
  );

  if ((existing?.count ?? 0) > 0) {
    return 0;
  }

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const cat = DEFAULT_CATEGORIES[i];
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO categories (id, user_id, name, icon, color, sort_order, is_unavoidable)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        id,
        userId,
        cat.name,
        cat.icon,
        cat.color,
        i,
        cat.is_unavoidable,
      );
    }
  });

  return DEFAULT_CATEGORIES.length;
}
