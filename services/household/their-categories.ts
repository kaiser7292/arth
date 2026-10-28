import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { iconForCategoryName } from "@/constants/category-icons";
import { createCategory } from "@/services/category";
import { bumpDataVersion } from "@/services/settings";
import { bestCategoryMatch, categoryMatchScore, getHouseholdCategories, getItems, getMembers } from "./store";
import { requestSync } from "./sync";
import type { Household, HouseholdItem } from "./types";

/**
 * The other members' categories, seen from my phone. Shared bills arrive filed under their
 * categories; ones I have no close match for ("Pets" when I have nothing like it) are listed so I
 * can map each to one of mine or create it. "Paid by …" shares then go there (mirror.ts).
 */

export interface TheirCategory {
  name: string;
  /** Who uses it. */
  members: string[];
  /** My category it's mapped to, by me. */
  mappedTo: string | null;
  /** My closest category, when there's only a loose match (same kind of spending). */
  suggestion: { id: string; name: string } | null;
  /** No mapping yet and no close match: needs a decision. */
  needsChoice: boolean;
}

const extraOf = (i: HouseholdItem): { ownCategory?: string | null } => {
  try {
    return i.payload_json ? JSON.parse(i.payload_json) : {};
  } catch {
    return {};
  }
};

/** My explicit choices: their category name → my category id. */
export async function getTheirCategoryMap(householdId: string): Promise<Map<string, string>> {
  const rows = await getDatabase().getAllAsync<{ name: string; local_category_id: string | null }>(
    "SELECT name, local_category_id FROM household_their_categories WHERE household_id = ? AND local_category_id IS NOT NULL;",
    householdId,
  );
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.local_category_id as string]));
}

export async function getTheirCategories(h: Household, userId: string = DEFAULT_USER_ID): Promise<TheirCategory[]> {
  const db = getDatabase();
  const names = new Map((await getMembers(h.id, true)).map((m) => [m.id, m.name]));
  const householdNames = new Set((await getHouseholdCategories(h.id)).map((c) => c.name.toLowerCase()));
  const mine = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order;",
    userId,
  );
  const mapped = await getTheirCategoryMap(h.id);

  // Every category name the others file things under (their own, not the household's list).
  const used = new Map<string, Set<string>>();
  for (const i of await getItems(h.id)) {
    if (i.member_id === h.my_member_id || (i.kind !== "tx" && i.kind !== "total")) continue;
    for (const n of [i.category_name, extraOf(i).ownCategory]) {
      if (!n || householdNames.has(n.toLowerCase()) || n === "Uncategorized") continue;
      const set = used.get(n) ?? new Set<string>();
      set.add(names.get(i.member_id) ?? "Someone");
      used.set(n, set);
    }
  }

  const out: TheirCategory[] = [];
  for (const [name, who] of used) {
    const mappedTo = mapped.get(name.toLowerCase()) ?? null;
    const best = bestCategoryMatch(name, mine);
    const score = best ? categoryMatchScore(name, best.name) : 0;
    if (!mappedTo && score >= 2) continue; // I have it, or something close enough: nothing to decide
    out.push({
      name,
      members: [...who],
      mappedTo,
      suggestion: score === 1 && best ? { id: best.id, name: best.name } : null,
      needsChoice: !mappedTo,
    });
  }
  return out.sort((a, b) => Number(b.needsChoice) - Number(a.needsChoice) || a.name.localeCompare(b.name));
}

export async function mapTheirCategory(h: Household, name: string, localCategoryId: string | null): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_their_categories (household_id, name, local_category_id, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (household_id, name) DO UPDATE SET local_category_id = excluded.local_category_id, updated_at = excluded.updated_at;`,
    h.id,
    name,
    localCategoryId,
  );
  bumpDataVersion();
  requestSync(500);
}

/** Creates a category of mine with their name (and a fitting icon), and maps theirs to it. */
export async function createFromTheirs(h: Household, name: string, userId: string = DEFAULT_USER_ID): Promise<string> {
  const look = iconForCategoryName(name);
  const id = await createCategory({
    user_id: userId,
    name: name.slice(0, 40),
    icon: look?.icon ?? "pricetag-outline",
    color: look?.color ?? "#6B7280",
  } as Parameters<typeof createCategory>[0]);
  await mapTheirCategory(h, name, id);
  return id;
}
