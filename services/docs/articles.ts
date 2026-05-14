/**
 * Article body loader. Markdown bodies ship inline in assets/docs/index.json
 * (each entry carries a body_md field). This avoids the Metro `.md` asset
 * resolver complexity and keeps article access sync + zero-IO at runtime.
 */

import type { DocsIndexEntry } from "./index";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const INDEX_BUNDLE = require("../../assets/docs/index.json") as {
  entries: Array<DocsIndexEntry & { body_md: string }>;
};

export function loadArticleBody(slug: string): string | null {
  const entry = INDEX_BUNDLE.entries.find((e) => e.slug === slug);
  return entry?.body_md ?? null;
}
