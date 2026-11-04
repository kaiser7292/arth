import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Outside its catch, a screen says it failed even when it loaded, and Try again can't clear it.
describe("a failed load is only flagged when the load failed", () => {
  const files = [...sources(join(ROOT, "app")), ...sources(join(ROOT, "components"))].filter((f) => readFileSync(f, "utf8").includes("setLoadFailed(true)"));

  it("found the screens", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))("%s", (_name, file) => {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes("setLoadFailed(true)")) return;
      const before = lines.slice(Math.max(0, i - 4), i).filter((l) => !/^\s*(\/\/|\/\*)/.test(l));
      const opener = [...before].reverse().find((l) => /\bcatch\b/.test(l));
      expect(opener).toBeDefined();
      // A catch closed on its own line has already ended.
      expect(opener!.trim()).toMatch(/\{\s*$/);
    });
  });
});
