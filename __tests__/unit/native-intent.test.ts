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

  it("leaves every other link alone (the Kite login return, routes)", () => {
    expect(redirectSystemPath({ path: "artha://kite-callback?request_token=x", initial: false })).toBe("artha://kite-callback?request_token=x");
    expect(redirectSystemPath({ path: "/settings/merchants", initial: false })).toBe("/settings/merchants");
    expect(hasIncoming()).toBe(false);
  });
});
