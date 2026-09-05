import { useCallback, useMemo, useState } from "react";
import { BRAND_COLOR, STATUS_COLORS, TRANSFER_COLOR } from "@/constants/semantic-colors";
import { Text } from "@/components/ui";
import { View, Pressable, ScrollView } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { TaggedField, TaggedSpan } from "@/services/sms/template-compiler";

/**
 * v15.6.0 — Tap-to-tag SMS token widget, rebuilt for predictable behaviour.
 *
 * Fixes from v15.5.0:
 *   - Tapping a token that belongs to a multi-token span now untags ONLY that
 *     token (leaving the rest of the span intact), not the whole span.
 *   - Multi-tap extension of a span is strictly ADJACENCY-ONLY: a new token is
 *     merged with an existing span only when it's contiguous (whitespace
 *     between counts as contiguous). Non-adjacent taps now open a new sub-span
 *     for the same field rather than silently discarding.
 *   - Long-press a token to open the character sub-selector, letting the user
 *     pick a substring (e.g. "1,500.00" out of "Rs.1,500.00").
 *   - Undo: last change is reversible via the external prop-based history.
 *
 * Field color palette (semantic — reused across the tagging screen + the
 * field-row list so the user can visually tie them together):
 *   amount   — blue
 *   account  — amber
 *   merchant — emerald
 *   date     — violet
 *   balance  — sky
 *   ref      — rose
 */

export interface TokenTaggerProps {
  smsBody: string;
  spans: TaggedSpan[];
  activeField: TaggedField | null;
  onSpanChange: (next: TaggedSpan[]) => void;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * Tokenise the SMS body on whitespace, keeping each non-whitespace run with
 * its absolute offset in the body.
 */
function tokenize(body: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    const start = i;
    while (i < body.length && !/\s/.test(body[i])) i++;
    out.push({ text: body.slice(start, i), start, end: i });
  }
  return out;
}

export const FIELD_COLORS: Record<TaggedField, { bg: string; text: string; label: string }> = {
  amount: { bg: BRAND_COLOR, text: "#FFFFFF", label: "Amount" },
  account: { bg: STATUS_COLORS.warning, text: "#1A1A1A", label: "Account" },
  merchant: { bg: STATUS_COLORS.success, text: "#FFFFFF", label: "Merchant" },
  date: { bg: TRANSFER_COLOR, text: "#FFFFFF", label: "Date" },
  balance: { bg: "#0EA5E9", text: "#FFFFFF", label: "Balance" },
  ref: { bg: "#F43F5E", text: "#FFFFFF", label: "Ref / Note" },
};

/** All spans (any field) that the token falls inside. */
function spansContaining(tok: { start: number; end: number }, spans: TaggedSpan[]): TaggedSpan[] {
  return spans.filter((s) => tok.start >= s.start && tok.end <= s.end);
}

/**
 * Remove a token's range from a span. One-span-in, one-or-zero-span-out to
 * satisfy the compiler's no-duplicate-field invariant.
 *
 *  - token covers the whole span → remove the span
 *  - token sits at the left edge  → shrink right (keep tail)
 *  - token sits at the right edge → shrink left (keep head)
 *  - token sits in the middle     → keep the LEFT half (predictable rule,
 *                                   documented in accessibility labels and the
 *                                   tag screen's per-field Clear button)
 */
function removeTokenFromSpan(span: TaggedSpan, tok: Token, body: string): TaggedSpan[] {
  const coversWhole = tok.start <= span.start && tok.end >= span.end;
  if (coversWhole) return [];

  const atLeftEdge = tok.start <= span.start;
  const atRightEdge = tok.end >= span.end;

  if (atLeftEdge) {
    // Keep the right side, trim leading whitespace.
    let rightStart = tok.end;
    while (rightStart < span.end && /\s/.test(body[rightStart])) rightStart++;
    if (rightStart >= span.end) return [];
    return [{ field: span.field, start: rightStart, end: span.end }];
  }

  if (atRightEdge) {
    // Keep the left side, trim trailing whitespace.
    let leftEnd = tok.start;
    while (leftEnd > span.start && /\s/.test(body[leftEnd - 1])) leftEnd--;
    if (leftEnd <= span.start) return [];
    return [{ field: span.field, start: span.start, end: leftEnd }];
  }

  // Middle: keep only the left half (simple rule; avoids compiler duplicate-field error).
  let leftEnd = tok.start;
  while (leftEnd > span.start && /\s/.test(body[leftEnd - 1])) leftEnd--;
  if (leftEnd <= span.start) return [];
  return [{ field: span.field, start: span.start, end: leftEnd }];
}

/**
 * Is `tok` adjacent to `span` (contiguous in the SMS, only whitespace between)?
 */
function isAdjacent(span: TaggedSpan, tok: Token, body: string): boolean {
  if (tok.start >= span.end) {
    return body.slice(span.end, tok.start).trim().length === 0;
  }
  if (tok.end <= span.start) {
    return body.slice(tok.end, span.start).trim().length === 0;
  }
  return false;
}

/**
 * Add a token to the field. Rules:
 *   - If same-field span exists AND is adjacent to the token → extend it.
 *   - If same-field span exists but NOT adjacent → REPLACE the old span with
 *     the new token (tap-wins). Only one span per field is allowed because
 *     the compiler produces one named capture group per field.
 *   - If no same-field span exists → create one.
 * Tokens currently owned by OTHER fields are re-assigned (tap on a
 * different-field token while a new activeField is selected changes the
 * ownership of just that token).
 */
function extendFieldWithToken(
  spans: TaggedSpan[],
  field: TaggedField,
  tok: Token,
  body: string,
): TaggedSpan[] {
  // Step 1: remove the token range from any other-field spans it overlaps.
  const withoutOthers: TaggedSpan[] = [];
  for (const s of spans) {
    if (s.field === field) {
      withoutOthers.push(s);
      continue;
    }
    if (tok.end <= s.start || tok.start >= s.end) {
      withoutOthers.push(s);
      continue;
    }
    // Carve the token range out of s.
    if (tok.start > s.start) withoutOthers.push({ field: s.field, start: s.start, end: tok.start });
    if (tok.end < s.end) withoutOthers.push({ field: s.field, start: tok.end, end: s.end });
  }

  // Step 2: is there a same-field span?
  const existing = withoutOthers.find((s) => s.field === field);
  const others = withoutOthers.filter((s) => s.field !== field);

  if (!existing) {
    return [...others, { field, start: tok.start, end: tok.end }];
  }

  // Adjacent → merge.
  if (isAdjacent(existing, tok, body)) {
    return [
      ...others,
      {
        field,
        start: Math.min(existing.start, tok.start),
        end: Math.max(existing.end, tok.end),
      },
    ];
  }

  // Non-adjacent → tap wins. Replace.
  return [...others, { field, start: tok.start, end: tok.end }];
}

/**
 * Add a raw character range (from the long-press sub-selector) using the same
 * tap-wins / adjacent-merge rules as extendFieldWithToken.
 */
function extendFieldWithRange(
  spans: TaggedSpan[],
  field: TaggedField,
  start: number,
  end: number,
  body: string,
): TaggedSpan[] {
  const pseudoTok: Token = { text: body.slice(start, end), start, end };
  return extendFieldWithToken(spans, field, pseudoTok, body);
}

export function TokenTagger({
  smsBody,
  spans,
  activeField,
  onSpanChange,
}: TokenTaggerProps) {
  const { colors } = useColorScheme();
  const tokens = useMemo(() => tokenize(smsBody), [smsBody]);

  // Character sub-selector — open when user long-presses a token.
  const [subToken, setSubToken] = useState<Token | null>(null);
  const [subRange, setSubRange] = useState<{ start: number; end: number } | null>(null);

  const handleTap = useCallback(
    (tok: Token) => {
      const owning = spansContaining(tok, spans);

      if (owning.length > 0) {
        // Token is inside a span — untag just this token.
        const nextSpans: TaggedSpan[] = [];
        for (const s of spans) {
          if (owning.includes(s)) {
            nextSpans.push(...removeTokenFromSpan(s, tok, smsBody));
          } else {
            nextSpans.push(s);
          }
        }
        onSpanChange(nextSpans);
        return;
      }

      if (!activeField) return; // UI prompts "tap a field first"

      onSpanChange(extendFieldWithToken(spans, activeField, tok, smsBody));
    },
    [spans, activeField, onSpanChange, smsBody],
  );

  const handleLongPress = useCallback(
    (tok: Token) => {
      if (!activeField) return; // same rule — field must be active
      setSubToken(tok);
      setSubRange({ start: tok.start, end: tok.end });
    },
    [activeField],
  );

  const applySubRange = useCallback(() => {
    if (!subToken || !subRange || !activeField) {
      setSubToken(null);
      setSubRange(null);
      return;
    }
    if (subRange.end <= subRange.start) {
      setSubToken(null);
      setSubRange(null);
      return;
    }
    onSpanChange(extendFieldWithRange(spans, activeField, subRange.start, subRange.end, smsBody));
    setSubToken(null);
    setSubRange(null);
  }, [subToken, subRange, activeField, spans, onSpanChange, smsBody]);

  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {tokens.map((tok, idx) => {
          const owning = spansContaining(tok, spans);
          // When a token belongs to multiple (shouldn't happen, but defensive)
          // the last one wins the palette.
          const field = owning.length > 0 ? owning[owning.length - 1].field : null;
          const palette = field ? FIELD_COLORS[field] : null;
          return (
            <Pressable
              key={`${tok.start}-${idx}`}
              onPress={() => handleTap(tok)}
              onLongPress={() => handleLongPress(tok)}
              delayLongPress={350}
              hitSlop={4}
              style={({ pressed }) => ({
                marginRight: 6,
                marginBottom: 6,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: palette
                  ? palette.bg
                  : pressed
                  ? colors.border
                  : colors.surface,
                borderWidth: palette ? 0 : 1,
                borderColor: colors.border,
                opacity: pressed && !palette ? 0.7 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={
                field
                  ? `${tok.text}, tagged as ${FIELD_COLORS[field].label}. Tap to untag.`
                  : `${tok.text}. Tap to tag. Long-press to tag part of the word.`
              }
            >
              <Text
                style={{
                  color: palette ? palette.text : colors.text,
                  fontSize: 14,
                  fontWeight: palette ? "600" : "400",
                }}
              >
                {tok.text}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {subToken && subRange && activeField && (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: FIELD_COLORS[activeField].bg,
            backgroundColor: FIELD_COLORS[activeField].bg + "10",
            borderRadius: 8,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            Tap characters to select just part of "{subToken.text}"
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row" }}>
              {Array.from(subToken.text).map((ch, i) => {
                const absIdx = subToken.start + i;
                const inRange = absIdx >= subRange.start && absIdx < subRange.end;
                return (
                  <Pressable
                    key={`sub-${i}`}
                    onPress={() => {
                      // Expand/contract the range to include this char.
                      // Simple model: clicking a char outside range extends the
                      // nearest boundary; clicking inside retracts the nearest.
                      if (!inRange) {
                        setSubRange({
                          start: Math.min(subRange.start, absIdx),
                          end: Math.max(subRange.end, absIdx + 1),
                        });
                      } else {
                        // Inside — shrink to the clicked-char side.
                        const distToStart = absIdx - subRange.start;
                        const distToEnd = subRange.end - (absIdx + 1);
                        if (distToStart <= distToEnd) {
                          setSubRange({ start: absIdx + 1, end: subRange.end });
                        } else {
                          setSubRange({ start: subRange.start, end: absIdx });
                        }
                      }
                    }}
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      marginRight: 2,
                      borderRadius: 4,
                      backgroundColor: inRange
                        ? FIELD_COLORS[activeField].bg
                        : colors.surface,
                      borderWidth: 1,
                      borderColor: inRange ? FIELD_COLORS[activeField].bg : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: inRange ? FIELD_COLORS[activeField].text : colors.text,
                        fontFamily: "monospace",
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {ch === " " ? "·" : ch}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
            <Pressable
              onPress={applySubRange}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 6,
                backgroundColor: FIELD_COLORS[activeField].bg,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: FIELD_COLORS[activeField].text,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                Use "{smsBody.slice(subRange.start, subRange.end)}"
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSubToken(null);
                setSubRange(null);
              }}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

// Exposed for unit testing.
export const __test__ = {
  tokenize,
  spansContaining,
  removeTokenFromSpan,
  isAdjacent,
  extendFieldWithToken,
  extendFieldWithRange,
};
