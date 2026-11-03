import { getDatabase } from "@/database";

const CHUNK = 300;

/**
 * Who each transaction is with, by name: the person it's split with ("Several people" for more than
 * one), or who a settlement came from. Transactions with nobody aren't in the map.
 */
export async function getPeopleForExpenses(expenseIds: readonly string[]): Promise<Map<string, string>> {
  const db = getDatabase();
  const out = new Map<string, string>();
  for (let i = 0; i < expenseIds.length; i += CHUNK) {
    const ids = expenseIds.slice(i, i + CHUNK);
    const ph = ids.map(() => "?").join(",");
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      `SELECT e.id, p.name FROM expenses e JOIN hisaab_persons p ON p.id = e.split_person_id WHERE e.id IN (${ph})
       UNION
       SELECT s.expense_id, p.name FROM expense_splits s JOIN hisaab_persons p ON p.id = s.hisaab_person_id WHERE s.expense_id IN (${ph})
       UNION
       SELECT h.linked_expense_id, p.name FROM hisaab_entries h JOIN hisaab_persons p ON p.id = h.hisaab_person_id
        WHERE h.type = 'settlement' AND h.linked_expense_id IN (${ph});`,
      ...ids,
      ...ids,
      ...ids,
    );
    for (const r of rows) out.set(r.id, out.has(r.id) && out.get(r.id) !== r.name ? "Several people" : r.name);
  }
  return out;
}
