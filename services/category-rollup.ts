/**
 * Sub-categories (migration 095): the category spending counts toward, i.e. its parent if it has
 * one. Budgets are set on top-level categories, so budget totals group by this.
 */
export function rolledUpCategorySql(col: string): string {
  // Only into a parent that still exists and is active; otherwise the category stands alone.
  return `COALESCE((SELECT rc.parent_id FROM categories rc JOIN categories pc ON pc.id = rc.parent_id AND pc.is_active = 1 WHERE rc.id = ${col}), ${col})`;
}
