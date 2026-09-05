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
 * The bridge is gone.
 *
 * These replace the "legacy bridge" tests, which asserted that the old colour surfaces and
 * useTheme() resolved to identical values while both were live. That invariant existed to keep the
 * branch bisectable during the sweep; now the point is that the old surfaces no longer exist at
 * all. TypeScript already proves it - the app compiles with them deleted - and these keep them
 * from creeping back.
 */
describe("bridge removed", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..", "..");

  it.each([
    "utils/accent.ts",
    "constants/accent-palettes.ts",
  ])("deleted %s", (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(false);
  });

  it("leaves constants/theme.ts with elevation only", () => {
    const mod = require("../../constants/theme");
    expect(Object.keys(mod)).toEqual(["Shadows"]);
  });

  it("keeps the brand ramp anchored to the launcher icon", () => {
    const { BRAND_RAMP, LIGHT, DARK } = require("../../constants/brand");
    // app.json paints the Android adaptive icon background with the ramp's darkest shade, so the
    // app and its launcher icon share a colour rather than merely resembling one.
    const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
    expect(BRAND_RAMP[900]).toBe(appJson.expo.android.adaptiveIcon.backgroundColor.toUpperCase());
    expect(LIGHT.primary).toBe(BRAND_RAMP[700]);
    expect(DARK.primary).toBe(BRAND_RAMP[400]);
  });

  it("has no accent, ac() or StatusColors call sites left in the UI", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (f.endsWith(".tsx")) files.push(f);
      }
    };
    for (const d of ["app", "components"]) walk(path.join(root, d));

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // Comments still mention "accent" descriptively; only code references matter.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
      if (/accent\[/.test(code) || /acAlpha\(/.test(code) || /StatusColors/.test(code)) {
        offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Regression guard for the class sweep.
 *
 * The legacy Tailwind keys have been deleted from tailwind.config.js, so any surviving legacy or
 * `dark:` class now compiles to NOTHING and renders an unstyled element. That failure is invisible
 * to TypeScript (it is a string), invisible to the rest of the suite (which mocks nativewind), and
 * shows up only as a wrong colour on a device. This is the only thing that catches it.
 */
describe("class sweep", () => {
  const fs = require("fs");
  const path = require("path");

  const FORBIDDEN = [
    "dark:",
    "text-text-primary",
    "text-text-secondary",
    "text-text-tertiary",
    "bg-surface-light",
    "bg-surface-dark",
    "bg-border-light",
    "border-border-light",
    "rounded-button",
    "text-micro",
  ];

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith(".tsx")) files.push(f);
    }
  };
  for (const d of ["app", "components"]) walk(path.join(__dirname, "..", "..", d));

  it.each(FORBIDDEN)("has no surviving `%s` class", (cls) => {
    const hits = files.filter((f) => fs.readFileSync(f, "utf8").includes(cls));
    expect(hits).toEqual([]);
  });

  it("scanned the whole UI surface", () => {
    expect(files.length).toBeGreaterThan(200);
  });
});

/**
 * Type scale guards.
 *
 * The audit measured 89% of the app's text at 14px or smaller, with 221 sites below 12px and six
 * at 8px. Two mechanisms fixed that: the arbitrary `text-[Npx]` values were retired onto the scale,
 * and Tailwind's own `xs`/`sm` steps were redefined (12->13, 14->15) so 2,723 call sites moved
 * without being edited. These tests stop either from silently regressing.
 */
describe("type scale", () => {
  const fs = require("fs");
  const path = require("path");
  const { TYPE, SCALE_OVERRIDES } = require("../../constants/design-tokens.js");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith(".tsx")) files.push(f);
    }
  };
  for (const d of ["app", "components"]) walk(path.join(__dirname, "..", "..", d));

  const px = (step: [string, object]) => parseFloat(step[0]);

  it("has no arbitrary text sizes left in source", () => {
    const hits = files
      .map((f) => ({ f, m: (fs.readFileSync(f, "utf8").match(/text-\[[0-9.]+px\]/g) || []) }))
      .filter((x: { m: string[] }) => x.m.length)
      .map((x: { f: string; m: string[] }) => x.f + ": " + x.m.join(", "));
    expect(hits).toEqual([]);
  });

  it("keeps every scale step at or above the 11.5px legibility floor", () => {
    for (const [name, step] of Object.entries({ ...TYPE, ...SCALE_OVERRIDES })) {
      expect({ name, px: px(step as [string, object]) }).toEqual({
        name,
        px: expect.any(Number),
      });
      expect(px(step as [string, object])).toBeGreaterThanOrEqual(11.5);
    }
  });

  it("keeps the redefined xs/sm steps above Tailwind's defaults", () => {
    // Reverting these two lines reverts the app-wide size change; that is deliberate.
    expect(px(SCALE_OVERRIDES.xs)).toBeGreaterThan(12);
    expect(px(SCALE_OVERRIDES.sm)).toBeGreaterThan(14);
  });

  it("gives the scale real hierarchy, not a flat range", () => {
    // The original failure was that nothing was big: only 63 sites in 223 files exceeded 18px.
    expect(px(TYPE.hero) / px(TYPE.body)).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Typeface routing guard.
 *
 * Inter is registered natively, but React Native applies no font family by default, so a bare
 * <Text> from react-native silently renders in the system font. Every screen therefore imports
 * Text from components/ui, which applies font-sans. A single stray react-native import is enough
 * to leave one screen in the wrong typeface, and nothing else would catch it.
 */
describe("typeface routing", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..", "..");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith(".tsx")) files.push(f);
    }
  };
  for (const d of ["app", "components"]) walk(path.join(root, d));

  it("imports Text from the ui primitive, never from react-native", () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join("components", "ui", "Text.tsx")))
      .filter((f) => {
        const m = fs.readFileSync(f, "utf8").match(/import\s*\{([^}]*)\}\s*from\s*"react-native"/);
        return m && m[1].split(",").map((x: string) => x.trim()).includes("Text");
      })
      .map((f: string) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("registers Inter as one Android family with real weights", () => {
    // The flat `fonts` array would create four separate families and font-semibold would fall
    // back to the system font instead of resolving to Inter SemiBold.
    const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
    const font = appJson.expo.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === "expo-font",
    );
    expect(font).toBeDefined();
    const family = font[1].android.fonts[0];
    expect(family.fontFamily).toBe("Inter");
    expect(family.fontDefinitions.map((d: { weight: number }) => d.weight)).toEqual([
      400, 500, 600, 700,
    ]);
  });
});
