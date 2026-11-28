/**
 * Reads a spoken entry ("450 at Swiggy for lunch, GPay, HDFC, yesterday") into expense fields
 * (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B). Plain code, no AI, fully tested:
 *
 *   amount   — spoken numbers in English and Hinglish (utils/spoken-number.ts)
 *   date     — today, yesterday, kal, "last Friday", "on the 5th" (utils/spoken-date.ts)
 *   merchant — your own merchants first, matched forgivingly ("D Mart" = DMart, "blink it" =
 *              Blinkit) and kept in your spelling; otherwise the words after "at" / "from"
 *   category — your category names, or everyday words that mean one (lunch → Food, petrol → Fuel)
 *   mode     — GPay, PhonePe, Paytm, CRED and BHIM are UPI; your own mode names win
 *
 * The on-device AI (services/ai/tasks/read-voice.ts) only fills what this leaves empty.
 */
import { normaliseSpokenNumbers, findAmount } from "@/utils/spoken-number";
import { readSpokenDate } from "@/utils/spoken-date";

export interface VoiceContext {
  /** Your merchants, most used first. */
  merchants?: readonly string[];
  categories?: readonly string[];
  /** Your payment mode names. */
  modes?: readonly string[];
}

export interface VoiceParseResult {
  amount?: number;
  merchant?: string;
  description?: string;
  /** The kind of payment said: "UPI" | "Cash" | "Card" | "Credit Card" | "Debit Card" | "Net Banking". */
  paymentModeName?: string;
  /** Your own payment mode for it, when you have one. */
  paymentMode?: string;
  /** Your own category, when the words point to one. */
  category?: string;
  /** YYYY-MM-DD if a day was said; undefined = today. */
  dateIso?: string;
}

/** Lower case, letters and digits only: "D-Mart" and "d mart" are both "dmart". */
export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function toTitleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const removeSpan = (s: string, index: number, length: number) =>
  (s.slice(0, index) + " " + s.slice(index + length)).replace(/\s+/g, " ").trim();
const removeText = (s: string, part: string) => {
  const i = s.toLowerCase().indexOf(part.toLowerCase());
  return i < 0 ? s : removeSpan(s, i, part.length);
};

/**
 * Everyday words → words to look for in your category names, in order of preference.
 * "lunch" finds a category called Food, Dining or Restaurants, whichever you have.
 */
const EVERYDAY: [RegExp, string[]][] = [
  [/\b(lunch|dinner|breakfast|brunch|snacks?|khana|nashta|biryani|pizza|burger|dosa|thali|restaurant|dining|food|swiggy|zomato|eating out)\b/, ["food", "dining", "restaurant", "eat"]],
  [/\b(chai|tea|coffee|cafe|starbucks)\b/, ["coffee", "cafe", "tea", "food", "dining"]],
  [/\b(groceries|grocery|kirana|sabzi|sabji|vegetables?|fruits?|milk|doodh|blinkit|zepto|instamart|bigbasket|dmart)\b/, ["grocer", "supermarket", "kirana", "vegetable", "food"]],
  [/\b(petrol|diesel|fuel|cng)\b/, ["fuel", "petrol", "car", "vehicle", "transport", "travel"]],
  [/\b(ola|uber|rapido|auto|rickshaw|cab|taxi|metro|bus|local train|commute)\b/, ["transport", "commute", "cab", "travel"]],
  [/\b(flight|train ticket|irctc|hotel|trip|holiday|vacation|makemytrip)\b/, ["travel", "trip", "holiday", "flight"]],
  [/\b(medicines?|dawai|dawa|pharmacy|chemist|doctor|hospital|clinic|tests?|apollo|medplus|1mg|pharmeasy)\b/, ["health", "medic", "doctor", "pharma"]],
  [/\b(gym|yoga|cult)\b/, ["fitness", "gym", "health"]],
  [/\b(rent|kiraya|society maintenance|maintenance)\b/, ["rent", "housing", "home", "house"]],
  [/\b(electricity|bijli|power bill)\b/, ["electric", "utilit", "bill"]],
  [/\b(water bill|gas|cylinder|lpg)\b/, ["gas", "water", "utilit", "bill"]],
  [/\b(recharge|mobile bill|phone bill|postpaid|prepaid|jio|airtel|vi)\b/, ["mobile", "phone", "recharge", "utilit", "bill"]],
  [/\b(wifi|broadband|internet)\b/, ["internet", "broadband", "wifi", "utilit", "bill"]],
  [/\b(netflix|hotstar|prime video|spotify|youtube premium|subscription)\b/, ["subscription", "ott", "entertain"]],
  [/\b(movies?|cinema|pvr|inox|concert|bookmyshow)\b/, ["entertain", "movie", "fun"]],
  [/\b(clothes|kapde|shirt|jeans|shoes|myntra|ajio)\b/, ["cloth", "apparel", "fashion", "shop"]],
  [/\b(amazon|flipkart|shopping|meesho)\b/, ["shop", "purchase"]],
  [/\b(haircut|salon|parlour|spa|grooming)\b/, ["beauty", "salon", "personal care", "grooming"]],
  [/\b(school fees?|tuition|course|books?|college fees?)\b/, ["education", "school", "tuition", "book"]],
  [/\b(gift|present)\b/, ["gift"]],
  [/\b(donation|temple|mandir|charity)\b/, ["donat", "charity", "religio"]],
  [/\b(insurance|premium|lic)\b/, ["insurance"]],
  [/\b(maid|bai|cook|driver|plumber|electrician|repair)\b/, ["household", "help", "repair", "service", "home"]],
];

/** Shops and apps in the everyday words above: said alone, they're the merchant (and still hint the category). */
export const BRANDS = new Set(
  "swiggy zomato dmart blinkit zepto instamart bigbasket uber ola rapido amazon flipkart myntra ajio meesho starbucks apollo medplus 1mg pharmeasy netflix hotstar spotify pvr inox bookmyshow makemytrip irctc jio airtel cult".split(" "),
);

/** Your category for a word list, matching whole words or 4+ letter prefixes. */
function categoryFor(keys: string[], categories: readonly string[]): string | undefined {
  for (const k of keys) {
    const hit = categories.find((c) => {
      const n = ` ${c.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
      return n.includes(` ${k} `) || n.includes(` ${k}s `) || (k.length >= 4 && n.includes(` ${k}`));
    });
    if (hit) return hit;
  }
  return undefined;
}

/** The category the words point to: your exact category name first, then everyday words. */
export function matchCategory(text: string, categories: readonly string[]): string | undefined {
  // "&" and "and" are the same when spoken: "Food & Dining" is said "food and dining".
  const words = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  const t = ` ${words(text)} `;
  const named = [...categories]
    .filter((c) => c.trim().length > 2)
    .sort((a, b) => b.length - a.length)
    .find((c) => t.includes(` ${words(c)} `));
  if (named) return named;
  for (const [re, keys] of EVERYDAY) if (re.test(t)) return categoryFor(keys, categories);
  return undefined;
}

/**
 * Your merchant said in the sentence, matched forgivingly: spaces and punctuation don't count,
 * so "D Mart", "blink it" and "Phone Pe" find DMart, Blinkit and PhonePe. The longest wins.
 */
export function matchMerchant(text: string, merchants: readonly string[]): string | undefined {
  const t = compact(text);
  let best: string | undefined;
  for (const m of merchants) {
    const c = compact(m);
    if (c.length < 3 || !t.includes(c)) continue;
    // Short names must be whole words, so "Ola" doesn't match "chocolate".
    if (c.length <= 4) {
      const words = text.toLowerCase().split(/[^a-z0-9]+/);
      const joined = words.map((_, i) => words.slice(i, i + 2).join(""));
      if (!words.includes(c) && !joined.includes(c)) continue;
    }
    if (!best || c.length > compact(best).length) best = m;
  }
  return best;
}

/** Payment kinds, most specific first. Apps are UPI. */
const PM_PATTERNS: [RegExp, string, RegExp?][] = [
  [/\b(credit\s*card|cc)\b/i, "Credit Card"],
  [/\b(debit\s*card)\b/i, "Debit Card"],
  [/\b(net\s*banking|netbanking|bank\s*transfer|online\s*banking|neft|rtgs|imps)\b/i, "Net Banking"],
  [/\b(gpay|g\s*pay|google\s*pay|phonepe|phone\s*pe|paytm|pay\s*tm|bhim|cred|amazon\s*pay|upi)\b/i, "UPI"],
  [/\b(cash|nakad|naqad)\b/i, "Cash"],
  [/\bcard\b/i, "Card"],
];

/** Your payment mode for what was said: a mode named for the app ("GPay") first, then the kind ("UPI"). */
export function matchPaymentMode(text: string, modes: readonly string[]): { kind?: string; mode?: string; said?: string } {
  const t = compact(text);
  // A mode of yours named in the sentence ("HDFC card", "GPay").
  const own = [...modes].filter((m) => compact(m).length >= 3).sort((a, b) => b.length - a.length).find((m) => t.includes(compact(m)));
  for (const [re, kind] of PM_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const mode = own ?? modes.find((x) => compact(x) === compact(kind)) ?? modes.find((x) => compact(x).includes(compact(kind)));
    return { kind, mode, said: m[0] };
  }
  return own ? { mode: own, said: own } : {};
}

/** Words that never make a merchant or description on their own. */
const STOP = new Set(
  "at from for to the a an and or in on as of rs rupees rupaye spent paid bought purchased spend expense via by using with through upi cash card gpay phonepe paytm bhim cred today yesterday kal parso ago days day i me my was it".split(" "),
);

/** Reads a spoken entry. `ctx` makes it use your own merchants, categories and modes. */
export function parseVoiceInput(raw: string, ctx: VoiceContext = {}, now: Date = new Date()): VoiceParseResult {
  const result: VoiceParseResult = {};
  const merchants = ctx.merchants ?? [];
  const categories = ctx.categories ?? [];
  const modes = ctx.modes ?? [];

  let s = normaliseSpokenNumbers(raw.trim()).replace(/[.,!?;]+(\s|$)/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:i\s+)?(?:spent|paid|bought|purchased|spend|expense|logged?|added?|gave|diya|diye)\s+/i, "");

  // Date first, so "on the 5th" isn't read as an amount or merchant.
  const day = readSpokenDate(s, now);
  if (day) {
    result.dateIso = day.dateIso;
    s = removeText(s, day.match);
  }

  const amt = findAmount(s);
  if (amt) {
    result.amount = amt.value;
    s = removeSpan(s, amt.index, amt.length);
  }

  const pm = matchPaymentMode(s, modes);
  if (pm.kind) result.paymentModeName = pm.kind;
  if (pm.mode) result.paymentMode = pm.mode;
  if (pm.said) s = removeText(s, pm.said);
  // "via", "by", "using", "through" left hanging after taking the mode out.
  s = s.replace(/\b(via|by|using|through|with|on)\s*$/i, "").trim();

  // Merchant: yours first, forgivingly; then the words after at / from / @.
  const known = matchMerchant(s, merchants);
  if (known) {
    result.merchant = known;
    s = removeKnown(s, known);
  } else {
    const atMatch = s.match(/\b(?:at|from|@)\s+([A-Za-z][A-Za-z0-9'&.\s]{1,30}?)(?=\s+(?:for|to|on|as|in|via|by|using)\b|\s*$)/i);
    if (atMatch) {
      result.merchant = toTitleCase(atMatch[1]);
      s = removeSpan(s, atMatch.index!, atMatch[0].length);
    }
  }

  // Description: after "for", or after "on" ("450 on groceries").
  const forMatch = s.match(/\b(?:for|on)\s+(.+)/i);
  if (forMatch) {
    result.description = forMatch[1].trim();
    s = removeSpan(s, forMatch.index!, forMatch[0].length);
  }

  // Category from your names or everyday words, anywhere in what was said (the merchant counts:
  // "Swiggy" means food).
  const cat = matchCategory(`${result.description ?? ""} ${s} ${result.merchant ?? ""}`, categories);
  if (cat) result.category = cat;

  // No merchant yet: the first leftover word, unless it's a category word ("450 groceries").
  if (!result.merchant) {
    const tokens = s.split(/\s+/).filter((t) => t.length > 1 && !/^\d/.test(t) && !STOP.has(t.toLowerCase()));
    const first = tokens[0];
    const brand = BRANDS.has(compact(first ?? ""));
    if (first && (brand || (!matchCategory(first, categories) && !EVERYDAY.some(([re]) => re.test(` ${first.toLowerCase()} `))))) {
      result.merchant = toTitleCase(first);
      s = removeText(s, first);
    }
  }

  if (!result.description) {
    const cleaned = s
      .split(/\s+/)
      .filter((w) => !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w))
      .join(" ")
      .trim();
    if (cleaned.length > 1) result.description = cleaned;
  }
  return result;
}

/** Take the merchant's words out of the sentence however they were spaced ("D Mart" for DMart). */
function removeKnown(s: string, merchant: string): string {
  const target = compact(merchant);
  const words = s.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      acc += compact(words[j]);
      if (acc === target) {
        const before = words.slice(0, i);
        // "at DMart": the "at" goes too.
        if (before.length && /^(at|from|@)$/i.test(before[before.length - 1])) before.pop();
        return [...before, ...words.slice(j + 1)].join(" ").trim();
      }
      if (!target.startsWith(acc)) break;
    }
  }
  return s;
}

/**
 * A reply that's only a command (docs §2.2 B5): "done", "skip", "yes", "no". Only when it's the
 * whole reply, so "done at the salon" and "bus pass" stay entries.
 */
export function wholeReply(text: string): "done" | "skip" | "yes" | "no" | undefined {
  const words = text
    .toLowerCase()
    .replace(/[^a-z' ]/g, " ")
    .split(/\s+/)
    // Filler around a command: "I'm done", "yes please", "skip this one", "skip category".
    .filter((w) => w && !FILLER_WORDS.has(w));
  const t = words.join(" ") || (/\b(ok|okay)\b/i.test(text) ? "ok" : "");
  if (/^(done|finish|finished|that's all|thats all|that is all|that's it|thats it|that's|thats|is|go ahead|open form|bas)$/.test(t)) return "done";
  if (/^(skip|next|pass|move on|leave|chhodo)$/.test(t)) return "skip";
  if (/^(yes|yeah|yep|yup|sure|ok|okay|confirm|save|haan|ha|theek hai|correct|right|proceed|go)( (yes|confirm|save|ok|okay|proceed|done))?$/.test(t)) return "yes";
  if (/^(no|nope|cancel|stop|nahi|nahin|wrong|abort|back|go back)$/.test(t)) return "no";
  return undefined;
}

/** Words that can sit around a command without changing it. */
const FILLER_WORDS = new Set(
  "i i'm im am it's its it this that one please thanks thank you ji the a just now okay ok so all field category merchant account mode payment amount date".split(" "),
);

/**
 * A transfer between your own accounts: "transfer 500 from HDFC to SBI", "move 2k to savings".
 * "Paid by bank transfer" is a payment, not a transfer.
 */
export function looksLikeTransfer(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(by|via|through|using|with)\s+(a\s+)?(bank\s+)?transfer\b|\bbank\s+transfer\b/.test(t)) return false;
  return /\b(self[-\s]?transfer(?:red)?|transfer(?:red)?)\b/.test(t) || /^(?:i\s+)?move[d]?\b.*\bto\b/.test(t);
}
