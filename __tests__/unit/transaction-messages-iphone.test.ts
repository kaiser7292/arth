import { readFileSync } from "fs";
import { join } from "path";

// iPhone gets messages through a Shortcut, so teaching and checking them can't be Android-only.
describe("message templates are reachable on iPhone", () => {
  const screen = readFileSync(join(__dirname, "../../app/settings/transaction-messages.tsx"), "utf8");
  const isGated = (title: string) => {
    const at = screen.indexOf(title);
    expect(at).toBeGreaterThan(-1);
    return /isAndroid && \([^]{0,200}$/.test(screen.slice(Math.max(0, at - 200), at));
  };
  it.each(["Message templates", "Scan history", "couldn't read"])("%s isn't hidden", (title) => {
    expect(isGated(title)).toBe(false);
  });
});
