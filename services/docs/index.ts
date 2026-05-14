/**
 * In-app help center — search + article retrieval.
 *
 * Architecture (Path A — authored phrasings, keyword + fuzzy search):
 *   - Articles live as markdown under assets/docs/articles/*.md.
 *   - Build time: scripts/build-docs-index.mjs writes assets/docs/index.json
 *     with frontmatter (title, slug, tags, contextKeys, phrasings, summary)
 *     plus a stripped body for full-text search.
 *   - Runtime: we load the index JSON (small, ~32 KB) once per session,
 *     cache it, and score queries against weighted fields.
 *
 * Ranking weights (highest → lowest):
 *   1. phrasings     — authored user-phrased questions (4x)
 *   2. title         — article title (3x)
 *   3. tags          — taxonomy tokens (2x)
 *   4. body          — stripped body (1x)
 *
 * Phrasings are the "semantic-feeling" layer — product owner authors the
 * mapping from user wording to article. A true semantic layer (MiniLM
 * vectors) is a later upgrade that would replace the scoring function
 * without changing this API.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const INDEX_BUNDLE = require("../../assets/docs/index.json") as DocsIndexBundle;

export interface DocsIndexEntry {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  contextKeys: string[];
  phrasings: string[];
  body_stripped: string;
}

export interface DocsIndexBundle {
  version: string;
  count: number;
  entries: DocsIndexEntry[];
}

export interface DocsSearchHit {
  entry: DocsIndexEntry;
  score: number;
  /** Which field gave the strongest signal (for UI badge/debug). */
  matchedField: "phrasings" | "title" | "tags" | "body";
}

// ─── Query normalization ────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "to", "for", "of", "in", "on", "at", "by", "with",
  "how", "what", "why", "when", "where", "i", "my", "me", "it", "this",
  "that", "and", "or", "but", "so", "can", "if", "as",
  // UI-scaffolding noise — "UI element month end projection" should be
  // treated as "month end projection".
  "ui", "element", "button", "tab", "page", "screen", "widget", "card",
  "icon", "pill", "chip", "row", "section", "field", "label", "show",
  "shows", "showing", "see", "view", "from", "vs", "versus",
]);

/**
 * Soft synonym expansion — one token → multiple search terms. Used during
 * scoring so that "cap" finds "budget", "projection" finds "forecast", etc.
 * Bidirectional: include both directions.
 *
 * Keep this list small and high-confidence. False positives hurt ranking.
 */
const SYNONYMS: Record<string, string[]> = {
  projection: ["forecast", "projected"],
  projected: ["forecast", "projection"],
  forecast: ["projection", "projected"],
  cap: ["budget", "limit"],
  caps: ["budget", "limit"],
  limit: ["cap", "budget"],
  "month-end": ["monthend"],
  monthend: ["month", "end"],
  pace: ["daily", "rate"],
  rate: ["pace"],
  confidence: ["accuracy", "reliable"],
  leak: ["leaks", "small"],
  leaks: ["leak"],
  creep: ["lifestyle", "inflation", "yoy"],
  "right-spend": ["avoidable", "avoidability", "unavoidable", "rightspend"],
  rightspend: ["avoidable", "avoidability", "unavoidable", "right-spend"],
  avoidable: ["rightspend", "right-spend", "unavoidable", "avoidability"],
  unavoidable: ["rightspend", "right-spend", "avoidable", "avoidability"],
  sms: ["message", "text", "bank-sms"],
  reminder: ["recurring", "upcoming", "dues"],
  reminders: ["recurring", "upcoming", "dues"],
  recurring: ["reminder", "reminders"],
  category: ["categories"],
  categories: ["category"],
  merchant: ["payee", "vendor", "merchants"],
  merchants: ["merchant", "payee", "vendor"],
  wallet: ["wallets", "paytm", "phonepe", "amazon-pay"],
  wallets: ["wallet"],
  upi: ["googlepay", "phonepe", "paytm"],
  backup: ["restore", "export"],
  restore: ["backup", "import"],
  delete: ["remove", "trash"],
  remove: ["delete", "trash"],
  edit: ["change", "update", "modify"],
  change: ["edit", "update", "modify"],
  compare: ["comparison", "yoy"],
  yoy: ["year", "compare", "comparison"],
  split: ["splits", "hisaab"],
  hisaab: ["split", "splits", "family", "friend"],
  goal: ["goals", "milestone", "target"],
  milestone: ["goal", "target"],
  duplicate: ["dupe", "duplicates"],
  duplicates: ["duplicate", "dupe"],
  refund: ["refunds", "return"],
  refunds: ["refund", "return"],
  "credit-card": ["creditcard", "cc"],
  creditcard: ["credit-card", "cc"],
  cc: ["credit-card", "creditcard"],
  dashboard: ["home", "summary"],
  home: ["dashboard"],
  insight: ["insights", "analytics"],
  insights: ["insight", "analytics"],
  analytics: ["insight", "insights"],
  review: ["approve", "queue"],
  lock: ["biometric", "password", "security"],
  biometric: ["lock", "fingerprint", "face"],
};

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Expand a single token through the synonyms table (returns including the token itself). */
function expandToken(token: string): string[] {
  const expansions = SYNONYMS[token];
  if (!expansions) return [token];
  return [token, ...expansions];
}

// ─── Scoring ────────────────────────────────────────────────────────

/**
 * Whole-word OR prefix hit, with synonym expansion. A query token counts
 * as a hit against `text` if the token, its prefix extension, OR any of its
 * synonyms appear as a whole word or word-prefix in `text`.
 *
 * Prefix example: "project" matches "projection", "projected", "projects".
 * Synonym example: "cap" also matches "budget" and "limit".
 */
function tokenHitCount(queryTokens: string[], text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of queryTokens) {
    const candidates = expandToken(t);
    if (candidates.some((c) => new RegExp(`\\b${escapeRegex(c)}`).test(lower))) {
      hits++;
    }
  }
  return hits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreEntry(queryTokens: string[], entry: DocsIndexEntry): DocsSearchHit | null {
  if (queryTokens.length === 0) return null;

  // Phrasings — treat each as an independent candidate. The best single
  // phrasing's hit-ratio drives the score, so a perfect phrasing match
  // wins even if the article body doesn't mention the exact words.
  let bestPhrasingScore = 0;
  for (const phrase of entry.phrasings) {
    const hits = tokenHitCount(queryTokens, phrase);
    const ratio = hits / queryTokens.length;
    if (ratio > bestPhrasingScore) bestPhrasingScore = ratio;
  }

  const titleHits = tokenHitCount(queryTokens, entry.title);
  const tagHits = tokenHitCount(queryTokens, entry.tags.join(" "));
  const bodyHits = tokenHitCount(queryTokens, entry.body_stripped);

  const titleScore = titleHits / queryTokens.length;
  const tagScore = tagHits / queryTokens.length;
  const bodyScore = bodyHits / queryTokens.length;

  // Weighted combine (phrasings 4x, title 3x, tags 2x, body 1x).
  const composite =
    bestPhrasingScore * 4 + titleScore * 3 + tagScore * 2 + bodyScore * 1;

  if (composite === 0) return null;

  // Which field was strongest — informs the UI hint and debug.
  const weighted: Array<[DocsSearchHit["matchedField"], number]> = [
    ["phrasings", bestPhrasingScore * 4],
    ["title", titleScore * 3],
    ["tags", tagScore * 2],
    ["body", bodyScore * 1],
  ];
  const matchedField = weighted.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  return { entry, score: composite, matchedField };
}

// ─── Public API ────────────────────────────────────────────────────

export function searchDocs(query: string, limit = 10): DocsSearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const hits: DocsSearchHit[] = [];
  for (const entry of INDEX_BUNDLE.entries) {
    const hit = scoreEntry(tokens, entry);
    if (hit) hits.push(hit);
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * v16.0.8 — ordered group definitions for the help center browse-all
 * list. Start → Track → Detect → Understand → Personalize → Protect
 * reflects the user's journey through the product.
 *
 * Within each group, slugs are listed in pedagogical order (what you
 * typically need to know first is listed first) rather than alphabetical.
 */
const DOMAIN_GROUPS: Array<{ label: string; slugs: string[] }> = [
  {
    label: "Start here",
    slugs: ["getting-started"],
  },
  {
    label: "Track day-to-day",
    slugs: [
      "accounts",
      "categories",
      "tags",
      "reconciliation",
      "refunds",
      "transfers",
      "hisaab",
      "review-queue",
    ],
  },
  {
    label: "Plan & remind",
    slugs: [
      "budget",
      "simulator",
      "reminders",
      "goals-milestones",
      "loans",
    ],
  },
  {
    label: "Let Artha do the work",
    slugs: [
      "sms-detection",
      "smart-sms-templates",
      "smart-rules",
      "merchant-aliases",
      "duplicate-detection",
    ],
  },
  {
    label: "Understand your money",
    slugs: [
      "insights",
      "projection-block",
      "projection-math",
      "min-balance-alert",
    ],
  },
  {
    label: "Personalize",
    slugs: [
      "preferences-region",
      "fiscal-year",
    ],
  },
  {
    label: "Protect your data",
    slugs: [
      "biometric-lock",
      "privacy-offline",
      "backup-restore",
      "recycle-bin",
      "audit-log",
      "excel-import",
    ],
  },
];

export interface DocsIndexGroup {
  label: string;
  articles: DocsIndexEntry[];
}

export function listArticleGroups(): DocsIndexGroup[] {
  const allBySlug = new Map(INDEX_BUNDLE.entries.map((e) => [e.slug, e]));
  const seen = new Set<string>();
  const groups: DocsIndexGroup[] = [];

  for (const group of DOMAIN_GROUPS) {
    const articles: DocsIndexEntry[] = [];
    for (const slug of group.slugs) {
      const entry = allBySlug.get(slug);
      if (entry && !seen.has(slug)) {
        articles.push(entry);
        seen.add(slug);
      }
    }
    if (articles.length > 0) groups.push({ label: group.label, articles });
  }

  // Any article that isn't in DOMAIN_GROUPS — surface it under "More"
  // so it stays reachable (future-added articles without pre-ordering).
  const remaining = INDEX_BUNDLE.entries
    .filter((e) => !seen.has(e.slug))
    .sort((a, b) => a.title.localeCompare(b.title));
  if (remaining.length > 0) groups.push({ label: "More", articles: remaining });

  return groups;
}

export function listAllArticles(): DocsIndexEntry[] {
  // Flattened view (used by the contextual-article filter). Preserves
  // the group ordering so the help center's "All articles" list — when
  // rendered flat — is at least in a sensible order.
  return listArticleGroups().flatMap((g) => g.articles);
}

export function getArticleMeta(slug: string): DocsIndexEntry | null {
  return INDEX_BUNDLE.entries.find((e) => e.slug === slug) ?? null;
}

export function getContextualArticles(contextKey: string): DocsIndexEntry[] {
  return INDEX_BUNDLE.entries.filter((e) => e.contextKeys.includes(contextKey));
}

export function getIndexVersion(): string {
  return INDEX_BUNDLE.version;
}
