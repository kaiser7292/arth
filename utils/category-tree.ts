/**
 * Sub-categories (migration 095): one level, a category either sits under a top-level parent or is
 * top-level itself. Pure helpers, so screens and tests share one idea of the tree.
 */

export interface TreeCategory {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface CategoryGroup<C extends TreeCategory> {
  parent: C;
  children: C[];
}

/**
 * Top-level categories in their order, each with its sub-categories. A sub-category whose parent
 * is missing (deleted, or not in the list passed in) is shown as top-level rather than lost.
 */
export function buildCategoryTree<C extends TreeCategory>(categories: readonly C[]): CategoryGroup<C>[] {
  const ids = new Set(categories.map((c) => c.id));
  const isChild = (c: C) => !!c.parent_id && c.parent_id !== c.id && ids.has(c.parent_id);
  const byParent = new Map<string, C[]>();
  for (const c of categories) {
    if (!isChild(c)) continue;
    const list = byParent.get(c.parent_id!) ?? [];
    list.push(c);
    byParent.set(c.parent_id!, list);
  }
  return categories.filter((c) => !isChild(c)).map((parent) => ({ parent, children: byParent.get(parent.id) ?? [] }));
}

/** "Food › Groceries" for a sub-category, the name alone for a top-level one. */
export function categoryPath<C extends TreeCategory>(category: C, byId: ReadonlyMap<string, C>): string {
  const parent = category.parent_id ? byId.get(category.parent_id) : undefined;
  return parent && parent.id !== category.id ? `${parent.name} › ${category.name}` : category.name;
}

/** The category budgets count this one toward: its parent if it has one, else itself. */
export function rollupCategoryId<C extends TreeCategory>(category: C, byId: ReadonlyMap<string, C>): string {
  return category.parent_id && byId.has(category.parent_id) ? category.parent_id : category.id;
}

/**
 * Why `childId` can't move under `parentId`, or null if it can. One level only: the new parent must
 * be top-level, and a category that has sub-categories can't become one.
 */
export function parentProblem<C extends TreeCategory>(childId: string, parentId: string | null, categories: readonly C[]): string | null {
  if (parentId == null) return null;
  if (parentId === childId) return "A category can't sit under itself.";
  const parent = categories.find((c) => c.id === parentId);
  if (!parent) return "That category no longer exists.";
  if (parent.parent_id) return "Sub-categories can't have sub-categories of their own.";
  if (categories.some((c) => c.parent_id === childId)) return "This category has sub-categories, so it can't go under another one.";
  return null;
}
