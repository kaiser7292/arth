import type Ionicons from "@expo/vector-icons/Ionicons";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * An icon and colour for a category from its name, for categories created without one (the AI
 * setup, Excel import, a quick add). Arth's built-in categories bring their own (database/defaults).
 *
 * Checked in order; the first entry with a word that appears in the name wins, so put the more
 * specific words first ("credit card" before "card", "fuel" before "car").
 */
export const CATEGORY_ICON_RULES: { words: string[]; icon: IconName; color: string }[] = [
  { words: ["transfer", "self transfer", "own account"], icon: "swap-horizontal-outline", color: "#64748B" },
  { words: ["invest", "sip", "mutual fund", "stock", "share", "equity", "demat", "gold"], icon: "trending-up-outline", color: "#16A34A" },
  { words: ["saving", "deposit", "fd"], icon: "wallet-outline", color: "#0D9488" },
  { words: ["emi", "loan", "credit card"], icon: "card-outline", color: "#2563EB" },
  { words: ["fuel", "petrol", "diesel"], icon: "speedometer-outline", color: "#EA580C" },
  { words: ["transport", "commute", "cab", "taxi", "uber", "ola", "auto", "metro", "bus", "train"], icon: "bus-outline", color: "#0284C7" },
  { words: ["car", "vehicle", "bike", "parking", "toll"], icon: "car-outline", color: "#475569" },
  { words: ["travel", "trip", "holiday", "vacation", "flight", "hotel"], icon: "airplane-outline", color: "#0EA5E9" },
  { words: ["health", "medic", "doctor", "hospital", "pharma", "clinic", "dental"], icon: "medkit-outline", color: "#DC2626" },
  { words: ["fitness", "gym", "sport", "yoga"], icon: "barbell-outline", color: "#F97316" },
  { words: ["insurance", "policy", "premium"], icon: "shield-checkmark-outline", color: "#0891B2" },
  { words: ["pet", "dog", "cat", "vet"], icon: "paw-outline", color: "#A16207" },
  { words: ["grocer", "supermarket", "vegetable", "kirana", "supplies"], icon: "cart-outline", color: "#65A30D" },
  { words: ["coffee", "cafe", "tea"], icon: "cafe-outline", color: "#92400E" },
  { words: ["drink", "bar", "alcohol", "liquor", "beer"], icon: "wine-outline", color: "#9F1239" },
  { words: ["food", "dining", "restaurant", "eat", "swiggy", "zomato", "delivery", "snack"], icon: "restaurant-outline", color: "#F97316" },
  { words: ["rent", "housing", "home", "house", "maintenance", "society"], icon: "home-outline", color: "#7C3AED" },
  { words: ["electric", "power", "utility", "utilities"], icon: "flash-outline", color: "#EAB308" },
  { words: ["water", "gas", "lpg", "cylinder"], icon: "water-outline", color: "#0EA5E9" },
  { words: ["mobile", "phone", "recharge", "postpaid", "prepaid"], icon: "phone-portrait-outline", color: "#6366F1" },
  { words: ["internet", "broadband", "wifi", "fibre", "fiber"], icon: "wifi-outline", color: "#4F46E5" },
  { words: ["bill"], icon: "receipt-outline", color: "#6366F1" },
  { words: ["subscription", "ott", "netflix", "streaming", "prime"], icon: "tv-outline", color: "#DB2777" },
  { words: ["entertain", "movie", "cinema", "concert", "event", "fun"], icon: "film-outline", color: "#C026D3" },
  { words: ["game", "gaming"], icon: "game-controller-outline", color: "#9333EA" },
  { words: ["music"], icon: "musical-notes-outline", color: "#DB2777" },
  { words: ["book", "reading"], icon: "book-outline", color: "#B45309" },
  { words: ["education", "school", "college", "tuition", "course", "class", "fees"], icon: "school-outline", color: "#1D4ED8" },
  { words: ["kid", "child", "baby"], icon: "happy-outline", color: "#F472B6" },
  { words: ["family", "parent"], icon: "people-outline", color: "#E11D48" },
  { words: ["gift"], icon: "gift-outline", color: "#DB2777" },
  { words: ["cloth", "apparel", "fashion", "shoe"], icon: "shirt-outline", color: "#9333EA" },
  { words: ["shop", "amazon", "flipkart", "myntra", "purchase"], icon: "bag-handle-outline", color: "#C026D3" },
  { words: ["electronic", "gadget", "laptop", "computer"], icon: "laptop-outline", color: "#334155" },
  { words: ["beauty", "salon", "personal care", "grooming", "spa", "parlour"], icon: "cut-outline", color: "#EC4899" },
  { words: ["donat", "charity", "temple", "church", "religio"], icon: "heart-circle-outline", color: "#E11D48" },
  { words: ["tax", "gst", "tds"], icon: "document-text-outline", color: "#475569" },
  { words: ["salary", "income", "bonus", "refund", "cashback", "interest"], icon: "cash-outline", color: "#16A34A" },
  { words: ["business", "office", "work"], icon: "briefcase-outline", color: "#334155" },
  { words: ["repair", "service", "household", "help", "maid", "cook", "driver"], icon: "construct-outline", color: "#78716C" },
  { words: ["cash", "atm", "withdrawal"], icon: "cash-outline", color: "#15803D" },
  { words: ["fee", "charge", "penalty"], icon: "pricetag-outline", color: "#B91C1C" },
];

/** The words of a name, lower case, so "Pet care" is ["pet", "care"] and "pet care". */
function matches(name: string, word: string): boolean {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  // Whole words, plus prefixes of 4+ letters ("invest" in "investments", "medic" in "medicine").
  return n.includes(` ${word} `) || n.includes(` ${word}s `) || (word.length >= 4 && n.includes(` ${word}`));
}

export function iconForCategoryName(name: string): { icon: IconName; color: string } | null {
  for (const r of CATEGORY_ICON_RULES) if (r.words.some((w) => matches(name, w))) return { icon: r.icon, color: r.color };
  return null;
}
