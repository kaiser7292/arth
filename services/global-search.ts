import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getCachedAngelHoldings } from "@/services/angel-connect";
import { getCategories } from "@/services/category";
import { searchDocs } from "@/services/docs";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getPersonsWithBalances } from "@/services/hisaab";
import { getCachedHoldings, getCachedMFHoldings } from "@/services/kite-connect";
import { getLifeMilestones } from "@/services/life-milestone";
import { listMerchants } from "@/services/merchants-overview";
import { listImageTemplates } from "@/services/receipt/image-templates";
import { availableCatalog, type CatalogEntry, type SearchTarget } from "@/services/search-catalog";
import { settingsStorage } from "@/services/storage";
import { listUserTemplates } from "@/services/sms/user-sms-templates";
import { getTags } from "@/services/tags";
import { getVaultEntries, vaultEntryMatches, VAULT_CATEGORY_LABELS, type VaultCategory } from "@/services/vault";
import { getAllActiveBuckets } from "@/services/yearly-plan";
import { parseAmountQuery } from "@/utils/amount-search";
import { logger } from "@/utils/logger";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { editDistance, normalizeText, queryTokens, semanticScore, synonymsFor } from "@/utils/search-semantics";

/**
 * "Search or do": actions and screens from the catalog, then the person's own data, grouped. Each
 * group fails alone, so one bad table never empties the results. Runs on the phone only. Vault entries
 * match on what's stored in the clear; secrets are never read here.
 */
export interface SearchResult {
  key: string;
  title: string;
  subtitle?: string;
  amount?: number;
  /** Money coming in, shown with a plus. */
  incoming?: boolean;
  icon: string;
  target?: SearchTarget;
  action?: CatalogEntry["action"];
}

export interface SearchGroup {
  key: string;
  title: string;
  /** How many there are in all, when that's more than are shown. */
  total?: number;
  /** Where "See all" goes. */
  seeAll?: SearchTarget;
  /** Best match in the group, for putting the likeliest group first. */
  score: number;
  results: SearchResult[];
}

const SHOW = 4;

/** Words about what to do to a transaction rather than which one: "change date swiggy" is about Swiggy. */
const ACTION_WORDS = new Set(
  "edit edits editing change changes changing fix correct correction modify update alter delete remove bulk many multiple several transaction transactions txn date dates amount amounts category categories merchant merchants account accounts mode modes payment split refund transfer tag".split(" "),
);
const VERBS = new Set("edit edits editing change changes changing fix correct correction modify update alter delete remove bulk".split(" "));

/** The words that name something, once it's clear the search is about changing it. */
export function withoutActionWords(tokens: string[]): string[] {
  if (!tokens.some((t) => VERBS.has(t))) return tokens;
  const rest = tokens.filter((t) => !ACTION_WORDS.has(t));
  return rest.length > 0 ? rest : tokens;
}

export function searchCatalog(query: string, entries: CatalogEntry[] = availableCatalog()): { actions: SearchResult[]; screens: SearchResult[]; best: number } {
  // Most changes are to one transaction: bulk actions lead only when the search asks for many.
  const wantsMany = /(bulk|many|multiple|several|batch|mass|all)/i.test(query);
  const score = (q: string) =>
    entries
      .map((e) => {
        const base = semanticScore(q, [e.title, e.words]);
        return { e, score: base > 0 && e.target?.params?.select && !wantsMany ? Math.max(1, base - 60) : base };
      })
      .filter((x) => x.score > 0);
  let matches = score(query);
  // "change date swiggy": no action has Swiggy in it, but the rest of the search is still an action.
  if (matches.length === 0) {
    const useful = queryTokens(query).filter((t) => score(t).length > 0);
    if (useful.length > 0) matches = score(useful.join(" "));
  }
  const scored = matches.sort((a, b) => b.score - a.score);
  const toResult = ({ e }: { e: CatalogEntry }): SearchResult => ({ key: `catalog:${e.id}`, title: e.title, icon: e.icon, target: e.target, action: e.action });
  return {
    actions: scored.filter((x) => x.e.kind === "do").slice(0, 6).map(toResult),
    screens: scored.filter((x) => x.e.kind === "go").slice(0, 6).map(toResult),
    best: scored[0]?.score ?? 0,
  };
}

/** Date words at the end or start of a search: "food last month". */
export function dateWordsIn(query: string, today: Date = new Date()): { rest: string; from?: string; to?: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const rules: [RegExp, () => [Date, Date]][] = [
    [/\blast month\b|\bpichle mahine\b/i, () => [new Date(y, m - 1, 1), new Date(y, m, 0)]],
    [/\bthis month\b|\bis mahine\b/i, () => [new Date(y, m, 1), new Date(y, m + 1, 0)]],
    [/\byesterday\b|\bkal\b/i, () => [new Date(y, m, d - 1), new Date(y, m, d - 1)]],
    [/\btoday\b|\baaj\b/i, () => [today, today]],
    [/\blast week\b/i, () => [new Date(y, m, d - 7), today]],
    [/\bthis year\b/i, () => [new Date(y, 0, 1), new Date(y, 11, 31)]],
  ];
  for (const [rx, range] of rules) {
    if (rx.test(query)) {
      const [from, to] = range();
      return { rest: query.replace(rx, " ").replace(/\s+/g, " ").trim(), from: iso(from), to: iso(to) };
    }
  }
  return { rest: query.trim() };
}

/** A typed name close to a real merchant ("swigy"): look for that merchant too. */
export function closeNames(token: string, names: readonly string[]): string[] {
  if (token.length < 4) return [];
  const allowed = token.length < 8 ? 1 : 2;
  const out = new Set<string>();
  for (const name of names) {
    for (const word of normalizeText(name).split(" ")) {
      if (word.length >= 4 && word !== token && editDistance(token, word, allowed) <= allowed) out.add(word);
    }
  }
  return [...out];
}

async function transactionsGroup(query: string, merchantNames: string[]): Promise<SearchGroup | null> {
  const db = getDatabase();
  const { rest, from, to } = dateWordsIn(query);
  const range = rest ? parseAmountQuery(rest) : null;
  const tokens = rest ? withoutActionWords(queryTokens(rest)) : [];
  const where: string[] = ["user_id = ?", "deleted_at IS NULL", "status <> 'rejected'", "nature IN ('realized', 'credit')"];
  const params: (string | number)[] = [DEFAULT_USER_ID];
  if (from && to) {
    where.push("date >= ? AND date <= ?");
    params.push(from, to);
  }

  const textFields = (like: string) => {
    params.push(like, like, like, like, like);
    return `(description LIKE ? OR merchant_name LIKE ? OR raw_merchant_name LIKE ?
      OR category_id IN (SELECT id FROM categories WHERE name LIKE ?)
      OR id IN (SELECT et.expense_id FROM expense_tags et JOIN tags t ON t.id = et.tag_id WHERE t.name LIKE ?))`;
  };

  if (range) {
    const whole = `%${rest}%`;
    const text = textFields(whole);
    where.push(`(${text} OR amount BETWEEN ? AND ? OR split_original_amount BETWEEN ? AND ?)`);
    params.push(range.min, range.max, range.min, range.max);
  } else {
    if (tokens.length === 0 && !from) return null;
    // A long sentence would hit the database's limit on search terms; the first few words decide it.
    for (const token of tokens.slice(0, 5)) {
      // Every word has to match; each can match through what it means or a typo of a real merchant.
      const words = [...new Set([token, ...synonymsFor(token), ...closeNames(token, merchantNames)])].filter((w) => w === token || w.length >= 2);
      where.push(`(${words.map((w) => textFields(`%${w}%`)).join(" OR ")})`);
    }
  }

  const clause = where.join(" AND ");
  const [rows, count] = await Promise.all([
    db.getAllAsync<{ id: string; title: string | null; merchant_name: string | null; description: string | null; date: string; nature: string; amount: number }>(
      `SELECT id, description AS title, merchant_name, description, date, nature, ${effectiveAmountSql("expenses")} AS amount
       FROM expenses WHERE ${clause} ORDER BY date DESC LIMIT ${SHOW};`,
      ...params,
    ),
    db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM expenses WHERE ${clause};`, ...params),
  ]);
  if (rows.length === 0) return null;
  const total = count?.n ?? rows.length;
  return {
    key: "transactions",
    title: "Transactions",
    total,
    seeAll: total > SHOW ? { pathname: "/(tabs)/expenses", params: { search: tokens.join(" ") || rest || query } } : undefined,
    score: 55,
    results: rows.map((r) => ({
      key: `tx:${r.id}`,
      title: r.description?.trim() || r.merchant_name?.trim() || "Transaction",
      subtitle: formatDateForDisplay(r.date),
      amount: r.amount,
      incoming: r.nature === "credit",
      icon: r.nature === "credit" ? "arrow-down-circle-outline" : "receipt-outline",
      target: { pathname: `/expense/${r.id}` },
    })),
  };
}

function scoreGroup<T>(
  key: string,
  title: string,
  query: string,
  items: readonly T[],
  fields: (item: T) => (string | null | undefined)[],
  toResult: (item: T) => Omit<SearchResult, "key"> & { key?: string },
  idOf: (item: T) => string,
): SearchGroup | null {
  const scored = items
    .map((item) => ({ item, score: semanticScore(query, fields(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  return {
    key,
    title,
    total: scored.length,
    score: scored[0].score,
    results: scored.slice(0, SHOW).map(({ item }) => ({ ...toResult(item), key: `${key}:${idOf(item)}` })),
  };
}

const accountName = (a: FinancialAccount) => a.account_label || `${a.bank_name} ••••${a.account_identifier}`;

/** Everything of the person's own that matches. Slowest part of a search, so it's loaded separately. */
export async function searchData(query: string): Promise<SearchGroup[]> {
  const q = query.trim();
  if (!q) return [];
  const db = getDatabase();
  const user = DEFAULT_USER_ID;

  const merchants = await listMerchants(user).catch(() => []);

  const run = (work: () => Promise<SearchGroup | null> | SearchGroup | null) =>
    Promise.resolve()
      .then(work)
      .catch((e) => {
        logger.warn("Search group failed", e);
        return null;
      });

  const groups = await Promise.all([
    run(() => transactionsGroup(q, merchants.map((m) => m.name))),
    run(() =>
      scoreGroup("merchants", "Merchants", q, merchants, (m) => [m.name, ...m.names.map((n) => n.smsName)], (m) => ({
        title: m.name,
        subtitle: `${m.txCount} transaction${m.txCount === 1 ? "" : "s"}`,
        icon: "storefront-outline",
        target: { pathname: "/settings/merchant-detail", params: { name: m.name } },
      }), (m) => m.name),
    ),
    run(async () => {
      const range = parseAmountQuery(q);
      const tokens = queryTokens(q);
      const params: (string | number)[] = [user];
      const text = tokens.map((t) => {
        params.push(`%${t}%`);
        return "t.description LIKE ?";
      });
      let clause = text.length > 0 ? `(${text.join(" AND ")})` : "1 = 0";
      if (range) {
        clause = `(${clause} OR t.amount BETWEEN ? AND ?)`;
        params.push(range.min, range.max);
      }
      const rows = await db.getAllAsync<{ id: string; description: string | null; amount: number; date: string; linked_expense_id: string | null }>(
        `SELECT t.id, t.description, t.amount, t.date, t.linked_expense_id FROM account_transfers t
         WHERE t.user_id = ? AND t.deleted_at IS NULL AND ${clause} ORDER BY t.date DESC LIMIT ${SHOW};`,
        ...params,
      );
      if (rows.length === 0) return null;
      return {
        key: "transfers",
        title: "Transfers",
        score: 50,
        results: rows.map((r) => ({
          key: `transfer:${r.id}`,
          title: r.description?.trim() || "Transfer",
          subtitle: formatDateForDisplay(r.date),
          amount: r.amount,
          icon: "swap-horizontal-outline",
          target: { pathname: r.linked_expense_id ? `/expense/${r.linked_expense_id}` : `/transfer/${r.id}` },
        })),
      };
    }),
    run(async () =>
      scoreGroup("categories", "Categories", q, await getCategories(user), (c) => [c.name], (c) => ({
        title: c.name,
        icon: c.icon || "grid-outline",
        target: { pathname: "/settings/category-edit", params: { id: c.id } },
      }), (c) => c.id),
    ),
    run(async () =>
      scoreGroup("tags", "Tags", q, await getTags(user), (t) => [t.name], (t) => ({
        title: t.name,
        icon: "pricetag-outline",
        target: { pathname: "/settings/tags" },
      }), (t) => t.id),
    ),
    run(async () => {
      const all = await getActiveAccounts(user);
      return scoreGroup("accounts", "Accounts", q, all, (a) => [a.account_label, a.bank_name, a.account_identifier, a.account_type.replace("_", " ")], (a) => ({
        title: accountName(a),
        subtitle: a.account_type.replace("_", " "),
        icon: "business-outline",
        target: (a.account_type === "demat"
          ? { pathname: "/demat/snapshots/[id]", params: { id: a.id } }
          : { pathname: "/reconciliation/account-ledger", params: { accountId: a.id } }) as SearchTarget,
      }), (a) => a.id);
    }),
    run(() => {
      // From the brokers' saved copies, so searching never calls out to a broker.
      const kite = getCachedHoldings().map((h) => ({ name: h.tradingsymbol, sub: "Zerodha", route: "/settings/kite-connect" }));
      const funds = getCachedMFHoldings().map((h) => ({ name: h.fund, sub: "Zerodha mutual fund", route: "/settings/kite-connect" }));
      const angel = getCachedAngelHoldings().map((h) => ({ name: h.tradingsymbol, sub: "Angel One", route: "/settings/angel-connect" }));
      return scoreGroup("holdings", "Holdings", q, [...kite, ...funds, ...angel], (h) => [h.name], (h) => ({
        title: h.name,
        subtitle: h.sub,
        icon: "trending-up-outline",
        target: { pathname: h.route },
      }), (h) => `${h.route}:${h.name}`);
    }),
    run(async () => {
      const rows = await db.getAllAsync<{ id: string; name: string; type: string }>(
        `SELECT l.id, COALESCE(fa.account_label, fa.bank_name) AS name, l.loan_type AS type
         FROM loan_accounts l JOIN financial_accounts fa ON fa.id = l.financial_account_id
         WHERE fa.user_id = ?;`,
        user,
      );
      return scoreGroup("loans", "Loans", q, rows, (l) => [l.name, l.type.replace(/_/g, " "), "loan"], (l) => ({
        title: l.name,
        subtitle: l.type.replace(/_/g, " "),
        icon: "cash-outline",
        target: { pathname: "/loans/[id]", params: { id: l.id } },
      }), (l) => l.id);
    }),
    run(async () =>
      scoreGroup("people", "People", q, await getPersonsWithBalances(user), (p) => [p.name], (p) => ({
        title: p.name,
        amount: Math.abs(p.balance) >= 0.5 ? Math.abs(p.balance) : undefined,
        subtitle: p.balance > 0.5 ? "Owes you" : p.balance < -0.5 ? "You owe" : "Settled",
        icon: "person-outline",
        target: { pathname: "/hisaab/ledger", params: { personId: p.id, personName: p.name } },
      }), (p) => p.id),
    ),
    run(async () => {
      const [buckets, milestones] = await Promise.all([getAllActiveBuckets(user), getLifeMilestones(user)]);
      const seen = new Set<string>();
      const goals = [
        ...milestones.map((m) => ({ id: `m:${m.id}`, name: m.name, target: { pathname: "/goals/milestone-detail", params: { milestoneId: m.id } } as SearchTarget })),
        ...buckets.map((b) => ({ id: `b:${b.id}`, name: b.name, target: { pathname: "/goals/investment-detail", params: { bucketId: b.id } } as SearchTarget })),
      ].filter((g) => {
        const key = g.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return scoreGroup("goals", "Goals", q, goals, (g) => [g.name], (g) => ({ title: g.name, icon: "flag-outline", target: g.target }), (g) => g.id);
    }),
    run(async () => {
      const rows = await db.getAllAsync<{ id: string; label: string | null; merchant_name: string | null; frequency: string }>(
        `SELECT r.id, e.description AS label, e.merchant_name, r.frequency FROM recurring_expense_rules r
         JOIN expenses e ON e.id = r.source_expense_id WHERE r.user_id = ? AND r.is_active = 1;`,
        user,
      );
      return scoreGroup("reminders", "Reminders", q, rows, (r) => [r.label, r.merchant_name], (r) => ({
        title: r.label?.trim() || r.merchant_name?.trim() || "Reminder",
        subtitle: r.frequency,
        icon: "alarm-outline",
        target: { pathname: "/settings/recurring-rule-detail", params: { ruleId: r.id } },
      }), (r) => r.id);
    }),
    run(async () => {
      const rows = await db.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM smart_rules WHERE user_id = ?;`, user);
      return scoreGroup("rules", "Smart rules", q, rows, (r) => [r.name], (r) => ({
        title: r.name,
        icon: "flash-outline",
        target: { pathname: "/settings/smart-rules/[id]", params: { id: r.id } },
      }), (r) => r.id);
    }),
    run(async () => {
      const [sms, images] = await Promise.all([listUserTemplates(), listImageTemplates(user)]);
      const all = [
        ...sms.map((t) => ({ id: `s:${t.id}`, name: t.bank_name, sub: "SMS template", target: { pathname: "/settings/sms-templates/[id]", params: { id: t.id } } as SearchTarget })),
        ...images.map((t) => ({ id: `i:${t.id}`, name: t.name, sub: "Picture template", target: { pathname: "/settings/image-template", params: { id: t.id } } as SearchTarget })),
      ];
      return scoreGroup("templates", "Templates", q, all, (t) => [t.name], (t) => ({ title: t.name, subtitle: t.sub, icon: "chatbox-ellipses-outline", target: t.target }), (t) => t.id);
    }),
    run(async () => {
      const rows = await db.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM simulation_scenarios WHERE user_id = ?;`, user);
      return scoreGroup("scenarios", "Simulator", q, rows, (s) => [s.name], (s) => ({
        title: s.name,
        icon: "git-branch-outline",
        target: { pathname: "/simulator/[id]", params: { id: s.id } },
      }), (s) => s.id);
    }),
    run(async () => {
      const rows = await db.getAllAsync<{ id: string; provider_name: string; policy_type: string }>(`SELECT id, provider_name, policy_type FROM insurance_policies;`);
      return scoreGroup("insurance", "Insurance", q, rows, (p) => [p.provider_name, p.policy_type], (p) => ({
        title: p.provider_name,
        subtitle: p.policy_type,
        icon: "shield-outline",
        target: { pathname: "/goals/risk-coverage" },
      }), (p) => p.id);
    }),
    run(async () => {
      const entries = await getVaultEntries();
      // Exact and word matches from the Vault's own rule, then meaning and typos on the same clear fields.
      const clear = (e: (typeof entries)[number]) => [e.title, e.username, e.email, e.url, e.notes, VAULT_CATEGORY_LABELS[e.category as VaultCategory]];
      const hits = entries.filter((e) => vaultEntryMatches(e, q) || semanticScore(q, clear(e)) > 0);
      return scoreGroup("vault", "Vault", q, hits, (e) => [...clear(e), e.title], (e) => ({
        title: e.title,
        subtitle: VAULT_CATEGORY_LABELS[e.category as VaultCategory] ?? "Vault",
        icon: "lock-closed-outline",
        target: { pathname: "/vault/[entryId]", params: { entryId: e.id } },
      }), (e) => e.id);
    }),
    run(() => {
      const hits = searchDocs(q, SHOW);
      if (hits.length === 0) return null;
      return {
        key: "help",
        title: "Help",
        score: 20,
        results: hits.map((h) => ({
          key: `help:${h.entry.slug}`,
          title: h.entry.title,
          icon: "help-circle-outline",
          target: { pathname: "/settings/help/[slug]", params: { slug: h.entry.slug } },
        })),
      };
    }),
  ]);

  return groups.filter((g): g is SearchGroup => g !== null).sort((a, b) => b.score - a.score);
}

// ── Recent ──

/** Registered in SETTINGS_REGISTRY (services/backup-settings.ts). */
const RECENT_KEY = "global_search_recent";
const MAX_RECENT = 6;

export function getRecentSearchResults(): SearchResult[] {
  const raw = settingsStorage.getString(RECENT_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function rememberSearchResult(r: SearchResult): void {
  // A shortcut back, not a record: titles only, never amounts.
  const entry: SearchResult = { key: r.key, title: r.title, subtitle: undefined, icon: r.icon, target: r.target, action: r.action };
  const next = [entry, ...getRecentSearchResults().filter((x) => x.key !== r.key)].slice(0, MAX_RECENT);
  settingsStorage.set(RECENT_KEY, JSON.stringify(next));
}

export function clearRecentSearchResults(): void {
  settingsStorage.delete(RECENT_KEY);
}
