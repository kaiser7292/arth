/**
 * Help center search tests. Exercises:
 *   - Query tokenization dropping stopwords
 *   - Phrasings weight (authored user-wording beats title match alone)
 *   - Title/tag/body scoring falls through when phrasings miss
 *   - Contextual routing returns articles tagged with a given contextKey
 *   - Article body retrieval via loadArticleBody
 *
 * Uses the real assets/docs/index.json bundle so the tests also guard
 * the authored phrasings / tags / body content from regressing silently.
 */

import {
  searchDocs,
  tokenize,
  listAllArticles,
  getArticleMeta,
  getContextualArticles,
} from "../../services/docs";
import { loadArticleBody } from "../../services/docs/articles";

describe("tokenize", () => {
  it("lowercases and drops stopwords", () => {
    expect(tokenize("How do I back up my data?")).toEqual(["back", "up", "data"]);
  });

  it("handles punctuation cleanly", () => {
    expect(tokenize("SMS isn't working!!")).toEqual(["sms", "isn", "t", "working"]);
  });

  it("returns empty for only stopwords / punctuation", () => {
    expect(tokenize("how what when")).toEqual([]);
  });
});

describe("searchDocs", () => {
  it("returns empty for empty query", () => {
    expect(searchDocs("")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
  });

  it("finds backup article from a phone-transfer phrasing", () => {
    const hits = searchDocs("got a new phone how do I move Artha");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.slug).toBe("backup-restore");
    expect(hits[0].matchedField).toBe("phrasings");
  });

  it("finds SMS detection from a privacy concern", () => {
    const hits = searchDocs("does Artha send my SMS anywhere");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.slug).toBe("sms-detection");
  });

  it("finds merchant-aliases from a PYU Swiggy question", () => {
    const hits = searchDocs("What is PYU Swiggy Food");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.slug).toBe("merchant-aliases");
  });

  it("finds reminders from a payment-status question", () => {
    const hits = searchDocs("I already paid but the reminder still shows due");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.slug).toBe("reminders");
  });

  it("phrasings beat a title-only match", () => {
    // "backup" appears in the backup article's title AND in merchant-
    // aliases' body_stripped (propagate rename affects past data — not
    // about backup). The phrasings wording in backup-restore should
    // dominate.
    const hits = searchDocs("I want to back up my data");
    expect(hits[0].entry.slug).toBe("backup-restore");
  });

  it("falls through to title/tags when no phrasing matches", () => {
    const hits = searchDocs("fiscal");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.slug).toBe("fiscal-year");
  });

  it("handles unmatched queries with an empty result", () => {
    const hits = searchDocs("quantum entanglement derivative swaps");
    expect(hits).toEqual([]);
  });
});

describe("listAllArticles", () => {
  it("returns every authored article in domain-journey order", () => {
    // v16.0.8 — ordering contract changed from alphabetical to domain
    // groups (Start here → Track → Plan → Detection → Insights →
    // Personalize → Protect). Getting-started must come first so new
    // users see it without scrolling.
    const all = listAllArticles();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all[0].slug).toBe("getting-started");
  });
});

describe("getArticleMeta", () => {
  it("returns meta for a known slug", () => {
    const meta = getArticleMeta("backup-restore");
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe("Backup and restore");
    expect(meta?.phrasings.length).toBeGreaterThan(5);
  });

  it("returns null for an unknown slug", () => {
    expect(getArticleMeta("no-such-article")).toBeNull();
  });
});

describe("getContextualArticles", () => {
  it("returns the SMS-detection article for the sms-settings context", () => {
    const related = getContextualArticles("sms-settings");
    const slugs = related.map((a) => a.slug);
    expect(slugs).toContain("sms-detection");
  });

  it("returns the review-queue article for the review-queue context", () => {
    const related = getContextualArticles("review-queue");
    const slugs = related.map((a) => a.slug);
    expect(slugs).toContain("review-queue");
  });

  it("returns empty for an unknown context key", () => {
    expect(getContextualArticles("no-such-context")).toEqual([]);
  });
});

describe("loadArticleBody", () => {
  it("returns markdown for a known slug with no frontmatter", () => {
    const body = loadArticleBody("backup-restore");
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/^---/);
    expect(body?.toLowerCase()).toContain("backup");
  });

  it("returns null for unknown slug", () => {
    expect(loadArticleBody("no-such-article")).toBeNull();
  });
});
