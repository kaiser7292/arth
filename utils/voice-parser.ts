export interface VoiceParseResult {
  amount?: number;
  merchant?: string;
  description?: string;
}

function toTitleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parses a voice transcript into expense fields.
 *
 * Handles patterns like:
 *   "Spent 450 at Swiggy for lunch"   → {amount:450, merchant:"Swiggy", description:"lunch"}
 *   "450 Swiggy"                      → {amount:450, merchant:"Swiggy"}
 *   "groceries at DMart 1200"         → {amount:1200, merchant:"DMart", description:"groceries"}
 *   "paid 850 for electricity"        → {amount:850, description:"electricity"}
 *   "1500"                            → {amount:1500}
 */
export function parseVoiceInput(raw: string): VoiceParseResult {
  const result: VoiceParseResult = {};
  let s = raw.trim();

  // Strip leading filler verbs ("I spent", "paid", "bought", etc.)
  s = s.replace(/^(?:i\s+)?(?:spent|paid|bought|purchased|spend|expense|logged?|added?)\s+/i, "");

  // Extract amount — a number optionally prefixed by ₹ / rs / rupees
  const amtMatch = s.match(/(?:₹|rs\.?\s*|rupees?\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (amtMatch) {
    const parsed = parseFloat(amtMatch[1].replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      result.amount = parsed;
      s = (s.slice(0, amtMatch.index) + " " + s.slice(amtMatch.index! + amtMatch[0].length))
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  // Extract merchant — word(s) directly after "at" / "from" / "@"
  const atMatch = s.match(/\b(?:at|from|@)\s+([A-Za-z][A-Za-z0-9'&.\s]{1,30}?)(?=\s+(?:for|to|on|as|in)\b|\s*$)/i);
  if (atMatch) {
    result.merchant = toTitleCase(atMatch[1]);
    s = (s.slice(0, atMatch.index) + " " + s.slice(atMatch.index! + atMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  // Extract description — everything after "for"
  const forMatch = s.match(/\bfor\s+(.+)/i);
  if (forMatch) {
    result.description = forMatch[1].trim();
    s = (s.slice(0, forMatch.index) + " " + s.slice(forMatch.index! + forMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  // If merchant still missing, the first capitalisable token that isn't a number
  // and isn't a stop-word is likely the merchant (e.g. "450 Swiggy")
  if (!result.merchant) {
    const stopWords = new Set(["at","from","for","to","the","a","an","and","or","in","on","as","of","rs","rupees","spent","paid","bought"]);
    const tokens = s.split(/\s+/).filter((t) => t.length > 1 && !/^\d/.test(t) && !stopWords.has(t.toLowerCase()));
    if (tokens.length > 0) {
      result.merchant = toTitleCase(tokens[0]);
      s = s.replace(tokens[0], "").replace(/\s+/g, " ").trim();
    }
  }

  // Any leftover non-stop-word tokens become the description (if still unset)
  if (!result.description) {
    const cleaned = s
      .replace(/\b(?:at|from|for|the|a|an|and|rs|rupees|spent|paid|on|in|to)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > 1) result.description = cleaned;
  }

  return result;
}
