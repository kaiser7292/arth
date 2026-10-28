import { redirectSystemPath } from "../../app/+native-intent";
import { hasIncoming, hrefForIncoming, takeIncoming } from "../../services/incoming-file";

describe("Open with Arth", () => {
  it("parks a file opened from another app until the app can show Restore", () => {
    const uri = "content://com.google.android.apps.nbu.files.provider/2/123";
    expect(redirectSystemPath({ path: uri, initial: true })).toBe("/");
    expect(hasIncoming()).toBe(true);
    const taken = takeIncoming();
    expect(taken).toEqual({ kind: "backup", uri });
    expect(hasIncoming()).toBe(false); // opened once
    expect(hrefForIncoming(taken!)).toBe(`/settings/backup-restore?incoming=${encodeURIComponent(uri)}`);
  });

  it("lets the share hook read an iPhone share link instead of routing it", () => {
    expect(redirectSystemPath({ path: "artha://dataUrl=arthShareKey", initial: true })).toBe("/");
    expect(hasIncoming()).toBe(false);
  });

  it("parks a widget button's screen when it starts Arth, so it opens after the splash and lock", () => {
    expect(redirectSystemPath({ path: "artha://expense/from-screenshot", initial: true })).toBe("/");
    const taken = takeIncoming();
    expect(taken).toEqual({ kind: "link", href: "/expense/from-screenshot" });
    expect(hrefForIncoming(taken!)).toBe("/expense/from-screenshot");
    expect(redirectSystemPath({ path: "artha://?voice=1", initial: true })).toBe("/");
    expect(takeIncoming()).toEqual({ kind: "link", href: "/?voice=1" });
  });

  it("lets a widget link route normally while Arth is already running", () => {
    expect(redirectSystemPath({ path: "artha://expense/add", initial: false })).toBe("artha://expense/add");
    expect(hasIncoming()).toBe(false);
  });

  it("leaves every other link alone (the Kite login return, routes)", () => {
    expect(redirectSystemPath({ path: "artha://kite-callback?request_token=x", initial: false })).toBe("artha://kite-callback?request_token=x");
    expect(redirectSystemPath({ path: "/settings/merchants", initial: false })).toBe("/settings/merchants");
    expect(hasIncoming()).toBe(false);
  });
});
