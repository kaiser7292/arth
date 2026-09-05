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

/**
 * The migration invariant.
 *
 * During the sweep both the legacy colour surfaces and the new token roles are live at once. If
 * they ever resolve to DIFFERENT values, the app renders half-old/half-new and there is no way to
 * tell from a screenshot which commit caused it. These tests make that divergence impossible.
 */
describe("legacy bridge", () => {
  const { Colors, StatusColors } = require("../../constants/theme");
  const { STATUS_COLORS, CHART_COLORS, TRANSFER_COLOR } = require("../../constants/semantic-colors");
  const { LIGHT, DARK, BRAND_RAMP, toHex } = require("../../constants/brand");
  const { getTheme } = require("../../hooks/use-theme");

  it("resolves Colors[scheme] to the same values as useTheme()", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = getTheme(scheme);
      expect(Colors[scheme].text).toBe(t.foreground);
      expect(Colors[scheme].textSecondary).toBe(t.mutedForeground);
      expect(Colors[scheme].background).toBe(t.background);
      expect(Colors[scheme].surface).toBe(t.card);
      expect(Colors[scheme].border).toBe(t.border);
      expect(Colors[scheme].tint).toBe(t.primary);
      expect(Colors[scheme].tabIconSelected).toBe(t.primary);
    }
  });

  it("resolves StatusColors[scheme] to the same values as useTheme()", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = getTheme(scheme);
      expect(StatusColors[scheme].success).toBe(t.success);
      expect(StatusColors[scheme].danger).toBe(t.danger);
      expect(StatusColors[scheme].warning).toBe(t.warning);
    }
  });

  it("ends the two-greens split between theme.ts and semantic-colors.ts", () => {
    // These disagreed in production (#22C55E vs #10B981) under a comment claiming they matched.
    expect(STATUS_COLORS.success).toBe(StatusColors.light.success);
    expect(STATUS_COLORS.error).toBe(StatusColors.light.danger);
    expect(STATUS_COLORS.warning).toBe(StatusColors.light.warning);
  });

  it("points the legacy accent ramp at the single brand ramp", () => {
    expect(Colors.primary).toBe(BRAND_RAMP);
    // The brand's darkest shade is the Android adaptive-icon background in app.json — the app and
    // its launcher icon finally share a colour.
    expect(BRAND_RAMP[900]).toBe("#134E4A");
    expect(LIGHT.primary).toBe(BRAND_RAMP[700]);
    expect(DARK.primary).toBe(BRAND_RAMP[400]);
  });

  it("derives chart and transfer colours from tokens, not literals", () => {
    expect(CHART_COLORS.axisMuted).toBe(LIGHT.faintForeground);
    expect(TRANSFER_COLOR).toBe(toHex(require("../../constants/design-tokens.js").DATA.transfer));
  });
});
