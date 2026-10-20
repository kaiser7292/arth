import { redirectSystemPath } from "../../app/+native-intent";
import { hasIncomingFile, restoreHrefFor, takeIncomingFile } from "../../services/incoming-file";

describe("Open with Arth", () => {
  it("parks a file opened from another app until the app can show Restore", () => {
    const uri = "content://com.google.android.apps.nbu.files.provider/2/123";
    expect(redirectSystemPath({ path: uri, initial: true })).toBe("/");
    expect(hasIncomingFile()).toBe(true);
    const taken = takeIncomingFile();
    expect(taken).toBe(uri);
    expect(hasIncomingFile()).toBe(false); // opened once
    expect(restoreHrefFor(taken!)).toBe(`/settings/backup-restore?incoming=${encodeURIComponent(uri)}`);
  });

  it("leaves every other link alone (the Kite login return, routes)", () => {
    expect(redirectSystemPath({ path: "artha://kite-callback?request_token=x", initial: false })).toBe("artha://kite-callback?request_token=x");
    expect(redirectSystemPath({ path: "/settings/merchants", initial: false })).toBe("/settings/merchants");
    expect(hasIncomingFile()).toBe(false);
  });
});
