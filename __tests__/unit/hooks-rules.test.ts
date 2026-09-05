/**
 * @jest-environment node
 *
 * Rules of hooks.
 *
 * A hook must run unconditionally and in the same order on every render. The theme conversion
 * inserted `const theme = useTheme()` mechanically, and three shapes break that: a plain helper
 * called conditionally or in a loop, a hook inside a callback, and a hook behind an early return.
 *
 * None of it is visible to TypeScript or to any other test here, and every instance crashes the
 * app at runtime with "Rendered more hooks than during the previous render". One shipped — a
 * helper on the Home screen called as `cond ? getUtilColor(x) : fallback`, which killed the app
 * on open — so this runs in CI rather than living in a script nobody remembers to invoke.
 */
const { execFileSync } = require("child_process");
const path = require("path");

describe("rules of hooks", () => {
  jest.setTimeout(60000);

  it("has no conditional, nested or helper-scoped hook calls", () => {
    const script = path.join(__dirname, "..", "..", "scripts", "audit-hooks.js");
    const out = execFileSync("node", [script], {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    });
    // The audit prints the offending file, line and reason, so a failure names the fix directly.
    expect(out.trim()).toBe("No rules-of-hooks violations found.");
  });
});
