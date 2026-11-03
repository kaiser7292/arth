/**
 * Makes search understand what someone meant, on the phone with no AI and no network: word endings,
 * typos, any word order, words that mean the same thing (English and everyday Hindi/Hinglish), and
 * filler like "how do I".
 */

const FILLER = new Set(
  "i me my mine we our a an the to of for in on at is are am do does did how what where when can could should would want wanna need needs please show see view open find get go take let lets with and or from by this that it about mera meri mere mujhe ka ki ke ko hai kaise kahan kya".split(" "),
);

/** Each line is one meaning; any word on it finds the others. */
const CONCEPTS: string[][] = [
  ["income", "salary", "salaried", "pay", "payslip", "paycheck", "wage", "wages", "earning", "earn", "stipend", "ctc", "take home", "in hand", "inhand", "tankhwah", "tankha", "pagar", "kamai", "aay"],
  ["bonus", "incentive", "variable", "appraisal"],
  ["spend", "spent", "spending", "expense", "expenditure", "kharcha", "kharch", "kharche", "paid", "payment"],
  ["money in", "credit", "credits", "received", "receive", "deposit", "refund", "cashback", "aaya", "mila"],
  ["money out", "debit", "debits", "outgoing"],
  ["cash flow", "cashflow", "my month", "monthly", "this month", "mahina", "summary", "overview", "left over", "leftover", "bacha"],
  ["budget", "limit", "cap", "allowance", "spending plan"],
  ["save", "saved", "saving", "savings", "bachat", "put away"],
  ["invest", "investment", "investing", "investor", "portfolio", "stock", "stocks", "share", "shares", "equity", "market", "holding", "holdings", "demat", "nivesh"],
  ["mutual fund", "mf", "sip", "sips", "fund", "funds"],
  ["fixed deposit", "fd", "fds", "term deposit", "td", "rd", "recurring deposit"],
  ["pension", "epf", "pf", "provident", "nps", "ppf", "retirement", "retire"],
  ["crypto", "bitcoin", "btc", "zebpay"],
  ["zerodha", "kite"],
  ["angel", "angel one", "angelone"],
  ["sync", "refresh", "fetch", "snapshot"],
  ["edit", "change", "changing", "fix", "correct", "correction", "modify", "update", "alter", "rename", "wrong", "mistake", "badlo", "sudhar"],
  ["bulk", "many", "multiple", "several", "batch", "mass", "ek saath"],
  ["remove", "delete", "deleting", "cancel", "stop", "hatao"],
  ["goal", "goals", "target", "bucket", "buckets", "milestone", "milestones", "lakshya", "dream"],
  ["plan", "planning", "yearly plan", "annual plan", "yearly"],
  ["project", "projection", "projections", "forecast", "future", "grow", "growth", "calculator", "returns"],
  ["simulator", "simulate", "scenario", "what if", "whatif"],
  ["loan", "loans", "emi", "emis", "debt", "borrowing", "mortgage", "home loan", "car loan", "karza", "karz", "prepayment", "prepay", "foreclose"],
  ["net worth", "networth", "wealth", "assets", "liabilities", "balance sheet", "worth"],
  ["tax", "taxes", "itr", "tds", "regime", "capital gains", "ltcg", "stcg", "kar"],
  ["health", "grade", "score", "report card", "fitness"],
  ["insurance", "policy", "policies", "premium", "cover", "coverage", "bima", "lic", "term plan", "mediclaim"],
  ["hisaab", "hisab", "ledger", "lend", "lent", "borrow", "borrowed", "owe", "owed", "owes", "udhaar", "udhar", "friend", "family", "split", "splitwise", "settle", "settlement", "settle up", "repay", "repaid", "paise wapas"],
  ["together", "household", "partner", "spouse", "wife", "husband", "shared", "share", "couple", "ghar", "parivaar"],
  ["vault", "password", "passwords", "pin", "login", "credential", "credentials", "secret", "mpin", "upi pin", "cvv", "tijori"],
  ["account", "accounts", "bank", "savings account", "balance", "khata", "paisa", "passbook"],
  ["card", "cards", "credit card", "creditcard", "cc", "statement"],
  ["wallet", "wallets", "paytm", "phonepe", "amazon pay", "gpay"],
  ["transaction", "transactions", "txn", "txns", "history", "entries", "entry", "lenden"],
  ["transfer", "transfers", "move", "moved", "self transfer", "neft", "imps", "rtgs"],
  ["review", "pending", "queue", "approve", "catch up", "catchup", "waiting", "unapproved"],
  ["duplicate", "duplicates", "dupe", "repeated", "double"],
  ["merchant", "merchants", "shop", "store", "vendor", "dukaan", "payee"],
  ["category", "categories", "label", "classify", "group"],
  ["tag", "tags"],
  ["rule", "rules", "smart rule", "automate", "automation", "auto", "automatic"],
  ["reminder", "reminders", "recurring", "subscription", "subscriptions", "bill", "bills", "due", "dues", "renewal", "rent", "netflix", "ott"],
  ["sms", "message", "messages", "scan", "shortcut", "bank message", "template", "templates", "format"],
  ["picture", "photo", "image", "screenshot", "receipt", "camera", "gallery"],
  ["voice", "speak", "mic", "microphone", "bolo"],
  ["backup", "back up", "restore", "export", "import", "excel", "csv", "pdf", "download", "new phone"],
  ["reconcile", "reconciliation", "tally", "match statement"],
  ["recycle", "bin", "trash", "deleted", "undo", "recover"],
  ["insight", "insights", "analytics", "analysis", "trend", "trends", "pattern", "patterns", "compare", "comparison", "report", "reports", "year in review", "yoy", "year over year"],
  ["setting", "settings", "preference", "preferences", "config", "configure"],
  ["security", "lock", "biometric", "fingerprint", "face", "privacy", "hide amounts", "hide"],
  ["notification", "notifications", "alert", "alerts"],
  ["calendar", "schedule"],
  ["region", "currency", "language", "financial year", "fiscal year", "fy", "date format"],
  ["help", "support", "how", "guide", "faq"],
  ["ai", "chatgpt", "claude", "assistant"],
  // What people call their spending, for finding it in transactions.
  ["food", "eating", "restaurant", "dining", "zomato", "swiggy", "khana", "lunch", "dinner", "breakfast"],
  ["grocery", "groceries", "kirana", "blinkit", "zepto", "instamart", "bigbasket", "sabzi"],
  ["travel", "cab", "taxi", "uber", "ola", "rapido", "flight", "train", "irctc", "metro", "fuel", "petrol", "diesel", "safar"],
  ["shopping", "amazon", "flipkart", "myntra", "ajio", "clothes", "kapde"],
  ["medical", "doctor", "hospital", "pharmacy", "medicine", "dawai"],
  ["utilities", "electricity", "bijli", "water", "gas", "internet", "wifi", "broadband", "mobile", "recharge"],
];

/** Ordinary word endings: "investments", "investing" and "invested" all reduce to "invest". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

const STEM_INDEX = new Map<string, Set<number>>();
const PHRASE_INDEX = new Map<string, number>();
CONCEPTS.forEach((line, i) => {
  for (const term of line) {
    if (term.includes(" ")) PHRASE_INDEX.set(term, i);
    else {
      const key = stem(term);
      if (!STEM_INDEX.has(key)) STEM_INDEX.set(key, new Set());
      STEM_INDEX.get(key)!.add(i);
    }
  }
});

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** The words that matter. A search of nothing but filler ("how do i") falls back to those words. */
export function queryTokens(query: string): string[] {
  const all = normalizeText(query).split(" ").filter(Boolean);
  const useful = all.filter((t) => !FILLER.has(t));
  return useful.length > 0 ? useful : all;
}

export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prior: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // A swap of two neighbours ("swigyg") counts as one slip.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prior[j - 2] + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > limit) return limit + 1;
    prior = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Short words have to be right: "cat" must not find "car". */
function typoAllowance(word: string): number {
  if (word.length < 4) return 0;
  return word.length < 8 ? 1 : 2;
}

function isTypoOf(typed: string, word: string): boolean {
  const allowed = typoAllowance(typed);
  return allowed > 0 && word.length >= 4 && editDistance(typed, word, allowed) <= allowed;
}

/** The meanings of a word, allowing for a typo in it. */
function conceptsFor(token: string): Set<number> {
  const exact = STEM_INDEX.get(stem(token));
  if (exact) return exact;
  const out = new Set<number>();
  for (const [key, lines] of STEM_INDEX) {
    if (isTypoOf(stem(token), key)) lines.forEach((l) => out.add(l));
  }
  return out;
}

/**
 * Other words to look for in stored data (transactions, merchants). Keeps to the word's own meanings,
 * and leaves out generic words like "payment" for specific searches only when there's nothing to expand.
 */
export function synonymsFor(token: string): string[] {
  const out = new Set<string>([token]);
  for (const i of conceptsFor(token)) for (const term of CONCEPTS[i]) out.add(term);
  return [...out];
}

function tokenScore(token: string, words: string[], text: string): number {
  const s = stem(token);
  let best = 0;
  for (const w of words) {
    if (w === token) return 100;
    if (stem(w) === s) best = Math.max(best, 95);
    else if (w.startsWith(token)) best = Math.max(best, 85);
    else if (token.length >= 3 && w.includes(token)) best = Math.max(best, 60);
    else if (isTypoOf(token, w)) best = Math.max(best, 55);
  }
  if (best > 0) return best;
  const concepts = conceptsFor(token);
  for (const w of words) {
    const lines = STEM_INDEX.get(stem(w));
    if (lines && [...lines].some((l) => concepts.has(l))) best = Math.max(best, 50);
  }
  if (best === 0) {
    for (const [phrase, line] of PHRASE_INDEX) if (concepts.has(line) && text.includes(phrase)) best = 45;
  }
  return best;
}

/**
 * How well a query matches some text, 0 for no match. Every word that matters has to match something,
 * in any order. The first text counts most, so a title beats words further down.
 */
export function semanticScore(query: string, texts: readonly (string | null | undefined)[]): number {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const fields = texts.map((t) => normalizeText(t ?? "")).filter(Boolean);
  if (fields.length === 0) return 0;

  const whole = normalizeText(query);
  let phrase = 0;
  if (fields[0] === whole) phrase = 60;
  else if (fields[0].startsWith(whole)) phrase = 40;
  else if (fields[0].includes(whole)) phrase = 25;

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    fields.forEach((field, i) => {
      const score = tokenScore(token, field.split(" "), field);
      best = Math.max(best, i === 0 ? score : score * 0.8);
    });
    if (best === 0) return 0;
    total += best;
  }
  return total / tokens.length + phrase;
}
