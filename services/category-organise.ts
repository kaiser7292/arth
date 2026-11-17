import { getDatabase } from "@/database";
import { DEFAULT_SUBCATEGORIES, SUBCATEGORY_ALIASES } from "@/database/defaults/categories";
import { createCategory, setCategoryParent, type Category } from "@/services/category";
import { bumpDataVersion } from "@/services/settings";

/**
 * "Organise my categories" (Settings › Categories): suggestions for fitting an existing set of
 * categories into the sub-category setup (migration 095). Nothing changes until the owner ticks
 * the suggestions and applies them, and every suggestion is reversible from the category screen.
 *
 * Two kinds:
 *   move  an existing main category that is really a sub-category ("Petrol", "Groceries")
 *         goes under its parent, keeping its transactions, rules and name
 *   add   a default sub-category is added under a main category that has none by that name
 */
export type OrganiseSuggestion =
  | { key: string; kind: "move"; categoryId: string; name: string; parentId: string; parentName: string; transactions: number }
  | { key: string; kind: "add"; parentId: string; parentName: string; name: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function getOrganiseSuggestions(userId: string): Promise<OrganiseSuggestion[]> {
  const db = getDatabase();
  const cats = await db.getAllAsync<Category>(
    "SELECT * FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order ASC;",
    userId,
  );
  const counts = new Map(
    (
      await db.getAllAsync<{ category_id: string; n: number }>(
        `SELECT category_id, COUNT(*) as n FROM expenses
          WHERE user_id = ? AND deleted_at IS NULL AND category_id IS NOT NULL GROUP BY category_id;`,
        userId,
      )
    ).map((r) => [r.category_id, r.n]),
  );
  const topLevel = cats.filter((c) => !c.parent_id);
  const byName = new Map(topLevel.map((c) => [norm(c.name), c]));
  const hasChildren = new Set(cats.filter((c) => c.parent_id).map((c) => c.parent_id!));

  // Which default sub-category name each existing main category could be.
  const subOf = new Map<string, { parent: string; sub: string }>();
  for (const [parent, subs] of Object.entries(DEFAULT_SUBCATEGORIES)) {
    for (const sub of subs) subOf.set(norm(sub), { parent, sub });
  }
  for (const [alias, target] of Object.entries(SUBCATEGORY_ALIASES)) subOf.set(norm(alias), target);

  const out: OrganiseSuggestion[] = [];
  const covered = new Set<string>(); // "parentId|sub" already taken by a move
  for (const c of topLevel) {
    const target = subOf.get(norm(c.name));
    if (!target || hasChildren.has(c.id)) continue;
    const parent = byName.get(norm(target.parent));
    if (!parent || parent.id === c.id) continue;
    out.push({
      key: `move:${c.id}`,
      kind: "move",
      categoryId: c.id,
      name: c.name,
      parentId: parent.id,
      parentName: parent.name,
      transactions: counts.get(c.id) ?? 0,
    });
    covered.add(`${parent.id}|${norm(target.sub)}`);
  }

  for (const [parentName, subs] of Object.entries(DEFAULT_SUBCATEGORIES)) {
    const parent = byName.get(norm(parentName));
    if (!parent) continue;
    const existing = new Set(cats.filter((c) => c.parent_id === parent.id).map((c) => norm(c.name)));
    for (const sub of subs) {
      if (existing.has(norm(sub)) || covered.has(`${parent.id}|${norm(sub)}`) || byName.has(norm(sub))) continue;
      out.push({ key: `add:${parent.id}:${sub}`, kind: "add", parentId: parent.id, parentName: parent.name, name: sub });
    }
  }
  return out;
}

/** Applies the ticked suggestions. Returns how many were applied. */
export async function applyOrganiseSuggestions(userId: string, picked: readonly OrganiseSuggestion[]): Promise<number> {
  let done = 0;
  // Moves first, so a parent never gains a child it then can't keep.
  for (const s of picked.filter((x) => x.kind === "move")) {
    if (s.kind !== "move") continue;
    try {
      await setCategoryParent(s.categoryId, s.parentId);
      done++;
    } catch {
      /* one level only: skipped if the category gained sub-categories meanwhile */
    }
  }
  for (const s of picked.filter((x) => x.kind === "add")) {
    if (s.kind !== "add") continue;
    await createCategory({ user_id: userId, name: s.name, parent_id: s.parentId });
    done++;
  }
  bumpDataVersion();
  return done;
}
