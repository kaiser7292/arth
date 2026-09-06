import fs from "fs";
import path from "path";

/**
 * The version-skip guard has now been wrong three times, on three different screens, in the same
 * way each time.
 *
 * The pattern is `if (lastVersionRef.current === currentVersion) return;` inside a load callback.
 * It asks "has anything been WRITTEN?" - but changing what you are LOOKING at (the month, the
 * financial year, a filter) writes nothing. So the guard swallowed the reload and the screen kept
 * rendering the previous period's data. It shipped on the transactions tab, then the budget tab,
 * and investment-buckets and yearly-plan had it too.
 *
 * A comparison against a bare data version is therefore never right on a screen whose load depends
 * on anything else. The stamp has to include what is being viewed - or the screen should use
 * `useDataRefresh(fn, { skipKey })`, which does it centrally.
 *
 * This test reads source rather than rendering, because the bug is a shape, not a behaviour any
 * single unit test would reach.
 */
const ROOTS = ["app", "components"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("data-version guard", () => {
  const files = ROOTS.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r));

  it("never compares a ref against a bare data version", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        // `x.current === currentVersion` / `=== getDataVersion()` with no viewed-state in the key
        if (/\.current\s*===\s*(currentVersion|getDataVersion\(\))/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("useDataRefresh still accepts a skipKey", () => {
    const src = fs.readFileSync(path.join("hooks", "use-data-refresh.ts"), "utf8");
    expect(src).toContain("skipKey");
    // The stamp must combine the version with the key, never one or the other.
    expect(src).toMatch(/getDataVersion\(\)\}\|\$\{skipKey/);
  });
});
