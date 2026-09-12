import fs from "fs";
import path from "path";

/**
 * Home's loadData batches ~13 queries in one Promise.all with no per-query isolation and a bare
 * `catch { }` around the whole thing. One throwing query (getDueRecurringReminders was the one
 * seen in production, via a corrupted reminder-link table) discarded every other result: review
 * counts froze, upcomingDues never got set, and the Loans card - fetched downstream of the
 * batch - never even ran.
 *
 * This reads source rather than rendering the screen (mocking ~13 services plus navigation,
 * SMS and preload context to exercise one failure path is not worth the fragility) - same
 * approach as __tests__/unit/data-refresh-guard.test.ts, written from the same class of bug.
 */
const HOME_FILE = path.join("app", "(tabs)", "index.tsx");

function extractPromiseAllEntries(src: string): string[] {
  const start = src.indexOf("await Promise.all([");
  if (start === -1) throw new Error("Promise.all block not found in Home loadData");
  const openBracket = src.indexOf("[", start);

  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Could not find end of Promise.all array");

  const body = src.slice(openBracket + 1, end);
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));
}

describe("Home loadData query isolation", () => {
  const src = fs.readFileSync(HOME_FILE, "utf8");
  const entries = extractPromiseAllEntries(src);

  it("has more than one query batched (guards against the block moving/disappearing)", () => {
    expect(entries.length).toBeGreaterThan(5);
  });

  it("gives every batched query its own .catch fallback", () => {
    const offenders = entries.filter((line) => !line.includes(".catch("));
    expect(offenders).toEqual([]);
  });

  it("moves getLoansSummary into the batch instead of leaving it downstream", () => {
    const inBatch = entries.some((line) => line.includes("getLoansSummary("));
    expect(inBatch).toBe(true);
  });

  it("no longer silently swallows a failure with a bare catch", () => {
    expect(src).not.toMatch(/catch\s*\{\s*\/\/\s*DB not ready\s*\}/);
  });
});
