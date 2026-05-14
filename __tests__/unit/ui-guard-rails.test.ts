/**
 * UI Guard Rails — Automated checks that catch rendering/startup bugs.
 *
 * These tests prevent recurrence of the following bugs found during first device testing:
 * 1. NativeWind styles not rendering (React Compiler breaks className interception)
 * 2. Content clipped behind status bar on bezel-less phones (missing padTop={false})
 * 3. Database not initialized at startup (screens silently fail)
 * 4. Default seed data missing (empty categories/payment modes on first launch)
 * 5. User ID mismatch between seed data and screens (FK violations)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_USER_ID } from "../../constants/app";

const ROOT = path.resolve(__dirname, "../..");

describe("UI Guard Rails", () => {
  describe("ScreenContainer padTop enforcement", () => {
    /**
     * Screens with a visible Stack/Tab header must use padTop={false}
     * to avoid double safe-area padding.
     *
     * Screens with headerShown: false (custom headers) must use
     * padTop={true} (the default) so the custom header doesn't
     * go behind the status bar.
     *
     * This list tracks screens with headerShown: false that correctly
     * omit padTop={false} — they're allowed to use the default.
     */
    const CUSTOM_HEADER_SCREENS = new Set([
      "app/expense/add.tsx",
      "app/expense/[id].tsx",
      "app/expense/review-queue.tsx",
      "app/budget/[categoryId].tsx",
      // v15.8.1: app/summary/[month].tsx migrated to Stack header — now uses padTop={false}.
      // v15 onboarding wizard — (onboarding)/_layout.tsx sets headerShown: false
      "app/(onboarding)/welcome.tsx",
      "app/(onboarding)/region.tsx",
      "app/(onboarding)/sms-consent.tsx",
      "app/(onboarding)/accounts-preview.tsx",
      "app/(onboarding)/done.tsx",
    ]);

    test("screens with Stack/Tab headers use padTop={false}", () => {
      const appDir = path.join(ROOT, "app");
      const files = findTsxFiles(appDir);

      const violations: string[] = [];

      for (const file of files) {
        if (file.endsWith("_layout.tsx")) continue;

        const relPath = path.relative(ROOT, file);

        // Skip screens that have headerShown: false — they use padTop={true}
        if (CUSTOM_HEADER_SCREENS.has(relPath)) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (
            line.includes("<ScreenContainer") &&
            !line.includes("import") &&
            !line.includes("padTop={false}")
          ) {
            violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });

    test("screens with custom headers do NOT use padTop={false}", () => {
      const violations: string[] = [];

      for (const relPath of CUSTOM_HEADER_SCREENS) {
        const file = path.join(ROOT, relPath);
        if (!fs.existsSync(file)) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // These screens should NOT have padTop={false} on their main render
          if (
            line.includes("<ScreenContainer") &&
            !line.includes("import") &&
            line.includes("padTop={false}")
          ) {
            violations.push(`${relPath}:${i + 1}: ${line.trim()} — should use default padTop`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("app.json config guards", () => {
    let appJson: Record<string, unknown>;

    beforeAll(() => {
      const raw = fs.readFileSync(path.join(ROOT, "app.json"), "utf-8");
      appJson = JSON.parse(raw);
    });

    test("reactCompiler is NOT enabled (breaks NativeWind)", () => {
      const experiments = (appJson.expo as Record<string, unknown>)
        ?.experiments as Record<string, unknown> | undefined;
      expect(experiments?.reactCompiler).not.toBe(true);
    });
  });

  describe("NativeWind babel config", () => {
    test("babel.config.js exists with jsxImportSource nativewind", () => {
      const babelPath = path.join(ROOT, "babel.config.js");
      expect(fs.existsSync(babelPath)).toBe(true);
      const content = fs.readFileSync(babelPath, "utf-8");
      expect(content).toContain("jsxImportSource");
      expect(content).toContain("nativewind");
    });
  });

  describe("user ID consistency", () => {
    test('seed.ts uses DEFAULT_USER_ID as user_id', () => {
      const seedPath = path.join(ROOT, "database", "seed.ts");
      if (fs.existsSync(seedPath)) {
        const content = fs.readFileSync(seedPath, "utf-8");
        // Should contain DEFAULT_USER_ID and NOT use generateUUID() for userId
        expect(content).toContain('DEFAULT_USER_ID');
      }
    });

    test("_layout.tsx initializes database and seeds defaults", () => {
      const layoutPath = path.join(ROOT, "app", "_layout.tsx");
      const content = fs.readFileSync(layoutPath, "utf-8");

      expect(content).toContain("initDatabase");
      expect(content).toContain("seedDefaultCategories");
      expect(content).toContain("seedDefaultPaymentModes");
    });
  });
});

/** Recursively find all .tsx files in a directory */
function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsxFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }

  return results;
}
