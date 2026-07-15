#!/usr/bin/env node
/**
 * Dev-only index builder for the in-app help center.
 *
 * Scans assets/docs/articles/*.md, parses YAML frontmatter, emits
 * assets/docs/index.json. Runs during batch builds, not on device.
 *
 * Frontmatter schema (required fields marked):
 *   title:        (required) display title
 *   slug:         (required) unique slug used in URLs + internal refs
 *   summary:      (optional) one-liner shown in browse list
 *   tags:         (list)    free-form tags for search weighting
 *   contextKeys:  (list)    stable keys referenced from LearnMoreChip
 *   phrasings:    (list)    user-worded questions/phrases that should
 *                           resolve to this article. This is the
 *                           "semantic-feeling" layer — we author the
 *                           mapping rather than compute it.
 *
 * List values use YAML block style (one item per line, `-` prefix).
 * Article body is the markdown below the closing `---`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = path.resolve(__dirname, "..", "assets", "docs", "articles");
const OUT_PATH = path.resolve(__dirname, "..", "assets", "docs", "index.json");
const BUILD_VERSION = new Date().toISOString().slice(0, 10);

function unquote(s) {
  if (
    (s.startsWith("\"") && s.endsWith("\"")) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Minimal YAML-ish frontmatter parser. Supports:
 *   key: scalar       → string
 *   key: [a, b]       → inline array of strings
 *   key:              → block list; next indented `- item` lines are values
 *     - item 1
 *     - item 2
 * Quoted strings (single or double) are accepted; quotes are stripped.
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("Missing or malformed frontmatter block.");
  const [, header, body] = m;

  const meta = {};
  const lines = header.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, key, rawVal] = kv;
    const val = rawVal.trim();

    if (val === "") {
      // Block list: collect subsequent `  - item` lines.
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const item = next.match(/^\s+-\s*(.*)$/);
        if (!item) break;
        items.push(unquote(item[1].trim()));
        j++;
      }
      meta[key] = items;
      i = j;
      continue;
    }

    if (val.startsWith("[") && val.endsWith("]")) {
      // Inline array.
      const inner = val.slice(1, -1);
      const parts = inner
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      meta[key] = parts;
      i++;
      continue;
    }

    meta[key] = unquote(val);
    i++;
  }

  return { meta, body: body.trim() };
}

/**
 * Strip markdown syntax for body-search indexing. Keeps just the words so
 * a TF-IDF-lite search runs fast on short, clean strings.
 */
function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")       // fenced blocks
    .replace(/`[^`]+`/g, " ")              // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → link text
    .replace(/[*_#>-]/g, " ")              // md marks
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function main() {
  const entries = [];
  const files = (await fs.readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const raw = (await fs.readFile(path.join(ARTICLES_DIR, file), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const { meta, body } = parseFrontmatter(raw);

    if (!meta.title) throw new Error(`${file}: missing title`);
    if (!meta.slug) throw new Error(`${file}: missing slug`);

    entries.push({
      slug: meta.slug,
      title: meta.title,
      summary: meta.summary ?? "",
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      contextKeys: Array.isArray(meta.contextKeys) ? meta.contextKeys : [],
      phrasings: Array.isArray(meta.phrasings) ? meta.phrasings : [],
      body_stripped: stripMarkdown(body),
      // Ship the raw markdown body inside the index so the viewer doesn't
      // need a separate .md-asset loader. Articles are small (~1-2 KB each),
      // total overhead is trivial.
      body_md: body,
    });
  }

  // Sort for deterministic output.
  entries.sort((a, b) => a.slug.localeCompare(b.slug));

  const bundle = {
    version: BUILD_VERSION,
    count: entries.length,
    entries,
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`[docs-index] wrote ${entries.length} articles → ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
