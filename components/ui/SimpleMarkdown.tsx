import { View, Linking } from "react-native";
import { Text } from "./Text";

/**
 * Minimal markdown renderer for in-app help articles.
 *
 * Supports: # ## ###, paragraphs, - bullets (with indented sub-bullets),
 * 1. 2. numbered lists (preserves author-specified numbering; supports
 * indented sub-bullets under any step), **bold**, `inline code`,
 * [label](slug) — tappable links that either navigate to another article
 * or open an external URL. Does NOT support: tables, images, code fences,
 * blockquotes.
 *
 * Sub-bullet syntax: two or more leading spaces followed by `- `. Max one
 * level of nesting (sub-sub-bullets are not supported).
 *
 * Link targets:
 *   - "http://…" / "https://…" → opens in the device browser via Linking
 *   - anything else            → treated as an article slug, navigates via
 *                                the `onArticlePress` callback
 */

interface SimpleMarkdownProps {
  body: string;
  /** Called when the user taps an internal article link. Required for
   *  Related-section links in help articles to be functional. */
  onArticlePress?: (slug: string) => void;
}

type ListItem = { text: string; subBullets: string[] };
type Block =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet-list"; items: ListItem[] }
  | { type: "numbered-list"; items: { num: number; text: string; subBullets: string[] }[] };

/**
 * Parse markdown into an ordered list of blocks. Ignores anything we don't
 * recognise so a bad input degrades to passthrough text.
 */
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      blocks.push({ type: `h${level}` as "h1" | "h2" | "h3", text: h[2].trim() });
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^-\s+/, "").trim();
        const subBullets: string[] = [];
        i++;
        // Collect indented sub-bullets (2+ leading spaces followed by `- `).
        while (i < lines.length && /^\s{2,}-\s+/.test(lines[i])) {
          subBullets.push(lines[i].replace(/^\s+-\s+/, "").trim());
          i++;
        }
        items.push({ text: itemText, subBullets });
      }
      blocks.push({ type: "bullet-list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: { num: number; text: string; subBullets: string[] }[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\d+)\.\s+(.*)$/);
        const num = m ? parseInt(m[1], 10) : items.length + 1;
        const text = m ? m[2].trim() : lines[i].trim();
        const subBullets: string[] = [];
        i++;
        // Collect indented sub-bullets belonging to this step.
        while (i < lines.length && /^\s{2,}-\s+/.test(lines[i])) {
          subBullets.push(lines[i].replace(/^\s+-\s+/, "").trim());
          i++;
        }
        items.push({ num, text, subBullets });
      }
      blocks.push({ type: "numbered-list", items });
      continue;
    }

    // Paragraph — collect consecutive non-blank lines.
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s+|-\s+|\d+\.\s+)/.test(lines[i]) &&
      !/^\s{2,}-\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ").trim() });
  }

  return blocks;
}

/**
 * Render inline markdown — **bold**, `code`, and [label](target) — as an
 * array of React children. Preserves whitespace between runs.
 */
function renderInline(
  text: string,
  keyPrefix: string,
  onArticlePress?: (slug: string) => void,
): React.ReactNode[] {
  // Split on bold OR code OR link tokens, keep delimiters so we can wrap.
  // Link matcher: [label](target) where neither contains ] or ).
  const tokens = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
    .filter(Boolean);
  return tokens.map((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
 if (tok.startsWith("**") && tok.endsWith("**")) {
 return (
 <Text key={key} className="font-semibold text-foreground">
 {tok.slice(2, -2)}
 </Text>
 );
 }
 if (tok.startsWith("`") && tok.endsWith("`")) {
 return (
 <Text
 key={key}
 className="text-foreground"
 style={{ fontFamily: "monospace", fontSize: 13 }}
 >
 {tok.slice(1, -1)}
 </Text>
 );
 }
 // Link: [label](target)
 const linkMatch = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
 if (linkMatch) {
 const label = linkMatch[1];
 const target = linkMatch[2];
 const isExternal = /^https?:\/\//i.test(target);
 return (
 <Text
 key={key}
 className="text-primary-600 underline"
 onPress={() => {
 if (isExternal) {
 Linking.openURL(target).catch(() => {
 // If the OS can't open it, silently swallow — not worth
 // surfacing an alert for a dead link in a help article.
 });
 } else if (onArticlePress) {
 onArticlePress(target);
 }
 }}
 accessibilityRole="link"
 >
 {label}
 </Text>
 );
 }
 return (
 <Text key={key} className="text-foreground">
 {tok}
 </Text>
 );
 });
}

export function SimpleMarkdown({ body, onArticlePress }: SimpleMarkdownProps) {
 const blocks = parseBlocks(body);

 return (
 <View>
 {blocks.map((block, idx) => {
 const key = `block-${idx}`;
 if (block.type === "h1") {
 return (
 <Text
 key={key}
 className="text-2xl font-bold text-foreground mb-3 mt-1"
 >
 {block.text}
 </Text>
 );
 }
 if (block.type === "h2") {
 return (
 <Text
 key={key}
 className="text-lg font-bold text-foreground mb-2 mt-5"
 >
 {block.text}
 </Text>
 );
 }
 if (block.type === "h3") {
 return (
 <Text
 key={key}
 className="text-base font-semibold text-foreground mb-2 mt-4"
 >
 {block.text}
 </Text>
 );
 }
 if (block.type === "paragraph") {
 return (
 <Text
 key={key}
 className="text-sm text-foreground leading-6 mb-3"
 >
 {renderInline(block.text, key, onArticlePress)}
 </Text>
 );
 }
 if (block.type === "bullet-list") {
 return (
 <View key={key} className="mb-3">
 {block.items.map((item, i) => (
 <View key={`${key}-${i}`} className="mb-1.5">
 <View className="flex-row">
 <Text className="text-sm text-muted-foreground mr-2">
 •
 </Text>
 <Text className="flex-1 text-sm text-foreground leading-6">
 {renderInline(item.text, `${key}-${i}`, onArticlePress)}
                    </Text>
                  </View>
                  {item.subBullets.length > 0 && (
                    <View className="ml-5 mt-1">
                      {item.subBullets.map((sub, j) => (
                        <View key={`${key}-${i}-sub-${j}`} className="flex-row mb-1">
 <Text className="text-sm text-muted-foreground mr-2">
 ◦
 </Text>
 <Text className="flex-1 text-sm text-foreground leading-6">
 {renderInline(sub, `${key}-${i}-sub-${j}`, onArticlePress)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          );
        }
        if (block.type === "numbered-list") {
          return (
            <View key={key} className="mb-3">
              {block.items.map((item, i) => (
                <View key={`${key}-${i}`} className="mb-1.5">
 <View className="flex-row">
 <Text className="text-sm text-muted-foreground mr-2 w-5">
 {item.num}.
 </Text>
 <Text className="flex-1 text-sm text-foreground leading-6">
 {renderInline(item.text, `${key}-${i}`, onArticlePress)}
                    </Text>
                  </View>
                  {item.subBullets.length > 0 && (
                    <View className="ml-7 mt-1">
                      {item.subBullets.map((sub, j) => (
                        <View key={`${key}-${i}-sub-${j}`} className="flex-row mb-1">
 <Text className="text-sm text-muted-foreground mr-2">
 •
 </Text>
 <Text className="flex-1 text-sm text-foreground leading-6">
 {renderInline(sub, `${key}-${i}-sub-${j}`, onArticlePress)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}
