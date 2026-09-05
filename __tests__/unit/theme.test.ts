/**
 * @jest-environment node
 *
 * Guards the design-token layer. These assertions cover the failure modes that are invisible to
 * TypeScript and to every other test in the suite, because they live in generated CSS and only
 * show up as wrong pixels on a device.
 */
const { verifyTheme, contrast, ratio } = require("../../scripts/verify-theme.js");
const { SEMANTIC, DATA } = require("../../constants/design-tokens.js");

describe("design tokens", () => {
  it("defines every semantic role in both schemes", () => {
    const light = Object.keys(SEMANTIC.light).sort();
    const dark = Object.keys(SEMANTIC.dark).sort();
    expect(dark).toEqual(light);
    expect(light.length).toBeGreaterThan(0);
  });

  it("stores colours as RGB channel triplets, never hex", () => {
    // Hex would make Tailwind's withAlphaValue fail to parse var(--x), silently dropping the
    // alpha on `bg-primary/10` rather than erroring.
    const all = [
      ...Object.values(SEMANTIC.light),
      ...Object.values(SEMANTIC.dark),
      ...Object.values(DATA.accountType),
      ...DATA.series,
      DATA.transfer,
    ];
    for (const v of all) {
      expect(v).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
});

describe("compiled theme", () => {
  // Compiling Tailwind + NativeWind is slower than a unit test; give it room.
  jest.setTimeout(60000);

  it("survives compilation with a light AND dark value for every role", async () => {
    const { rootVariables, failures } = await verifyTheme();

    // Surfaces the real reason rather than just a count mismatch.
    expect(failures).toEqual([]);

    for (const role of Object.keys(SEMANTIC.light)) {
      const name = "--color-" + role.replace(/[A-Z]/g, (c: string) => "-" + c.toLowerCase());
      expect(rootVariables[name]).toBeDefined();
      expect(rootVariables[name]).toHaveProperty("light");
      // If this fails, global.css used `.dark` instead of `.dark:root`, or the block was
      // purged by Tailwind for sitting inside @layer base. Dark mode is off app-wide.
      expect(rootVariables[name]).toHaveProperty("dark");
    }
  });
});

describe("contrast", () => {
  it("clears WCAG AA for every text role on every ground", () => {
    const bad = contrast.filter((c: { ratio: number }) => c.ratio < 4.5);
    expect(bad).toEqual([]);
  });

  it("keeps solid amber out of text roles", () => {
    // #F59E0B is 2.1:1 on white. The old codebase used it as a label 43 times.
    const onWhite = ratio(SEMANTIC.light.accentSolid, SEMANTIC.light.card);
    expect(onWhite).toBeLessThan(4.5);
    // ...which is exactly why a separate, darkened `accent` role exists for text.
    expect(ratio(SEMANTIC.light.accent, SEMANTIC.light.card)).toBeGreaterThanOrEqual(4.5);
  });
});
