/**
 * "Your name in bank messages" — the names banks print for the user on
 * transfers between their own accounts ("Transferred to Mr. SOURAVBAID",
 * "linked to mobile …-SOURAV BAI"). Knowing them lets the SMS pipeline treat
 * those movements as transfers instead of spending or income.
 *
 * Stored in settings (backed up). Arth suggests a name once it has seen it in
 * a few bank messages; the user confirms or dismisses it.
 */

import { getDatabase } from "@/database";
import { settingsStorage } from "@/services/storage";
import { parseBankSMS } from "@/services/sms/bank-patterns";
import { normalizeName, matchesAnySelfName } from "@/services/sms/money-signals";
import { bumpDataVersion } from "@/services/settings";

const SELF_NAMES_KEY = "self_names";
const SELF_NAMES_DISMISSED_KEY = "self_names_dismissed";

function readList(key: string): string[] {
  try {
    const raw = settingsStorage.getString(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function getSelfNames(): string[] {
  return readList(SELF_NAMES_KEY);
}

export function setSelfNames(names: string[]): void {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const n of names) {
    const t = n.replace(/\s{2,}/g, " ").trim();
    const key = normalizeName(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push(t);
  }
  settingsStorage.set(SELF_NAMES_KEY, JSON.stringify(clean));
  bumpDataVersion();
}

export function addSelfName(name: string): void {
  setSelfNames([...getSelfNames(), name]);
}

export function removeSelfName(name: string): void {
  const key = normalizeName(name);
  setSelfNames(getSelfNames().filter((n) => normalizeName(n) !== key));
}

export function getDismissedSelfNames(): string[] {
  return readList(SELF_NAMES_DISMISSED_KEY);
}

export function dismissSelfNameSuggestion(name: string): void {
  const list = getDismissedSelfNames();
  const key = normalizeName(name);
  if (!list.some((n) => normalizeName(n) === key)) list.push(name);
  settingsStorage.set(SELF_NAMES_DISMISSED_KEY, JSON.stringify(list));
  bumpDataVersion();
}

/** Is this SMS counterparty the user? */
export function isSelfName(candidate: string | null | undefined): boolean {
  return matchesAnySelfName(candidate, getSelfNames());
}

// ─── Suggestion ──────────────────────────────────────────────────────────────

/** Words that mark a business, not a person. */
const BUSINESS_WORDS =
  /\b(?:PVT|PRIVATE|LTD|LIMITED|LLP|INC|BANK|INDIA|TECHNOLOGIES|TECH|SERVICES|SOLUTIONS|ENTERPRISES?|TRADERS|STORES?|MART|CORP|CORPORATION|COMPANY|CO|FUND|INSURANCE|FINANCE|CAPITAL|SECURITIES|PAYMENTS?|MOBILE|NEFT|IMPS|UPI|RTGS|CLOSURE|ACCOUNT|SALARY|INTEREST)\b/i;

/** A plausible person's name: letters only, ≥ 8 letters, not a business. */
export function looksLikePersonName(name: string): boolean {
  if (/\d/.test(name)) return false;
  if (BUSINESS_WORDS.test(name)) return false;
  return normalizeName(name).length >= 8;
}

/** Times a name must appear before Arth asks about it. */
export const SELF_NAME_SUGGEST_MIN_COUNT = 3;

/**
 * Pure: the most frequent person-like counterparty name among these SMS
 * bodies that isn't already saved or dismissed. Names that are the same
 * person ("SOURAV BAI", "SOURAVBAID") are counted together under the longest
 * spelling seen.
 */
export function pickSelfNameSuggestion(
  bodies: readonly string[],
  saved: readonly string[],
  dismissed: readonly string[],
): { name: string; count: number } | null {
  const groups: { display: string; count: number }[] = [];
  for (const body of bodies) {
    const name = parseBankSMS(body)?.counterpartyName;
    if (!name || !looksLikePersonName(name)) continue;
    const g = groups.find((x) => matchesAnySelfName(name, [x.display]));
    if (g) {
      g.count++;
      if (normalizeName(name).length > normalizeName(g.display).length) g.display = name;
    } else {
      groups.push({ display: name, count: 1 });
    }
  }
  const best = groups
    .filter((g) => g.count >= SELF_NAME_SUGGEST_MIN_COUNT)
    .filter((g) => !matchesAnySelfName(g.display, saved) && !matchesAnySelfName(g.display, dismissed))
    .sort((a, b) => b.count - a.count)[0];
  return best ? { name: best.display, count: best.count } : null;
}

/** Reads recent bank SMS from the app's own SMS log and suggests a name, if any. */
export async function getSelfNameSuggestion(userId: string): Promise<{ name: string; count: number } | null> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ body: string }>(
    `SELECT body FROM pending_sms WHERE user_id = ? AND status IN ('processed', 'pending')
      ORDER BY sms_date DESC LIMIT 600;`,
    userId,
  );
  return pickSelfNameSuggestion(
    rows.map((r) => r.body),
    getSelfNames(),
    getDismissedSelfNames(),
  );
}
