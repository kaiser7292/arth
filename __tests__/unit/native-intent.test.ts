import { redirectSystemPath } from "../../app/+native-intent";

describe("Open with Arth", () => {
  it("sends a file opened from another app to Restore, with the file attached", () => {
    const uri = "content://com.android.providers.downloads.documents/document/msf%3A123";
    expect(redirectSystemPath({ path: uri, initial: true })).toBe(`/settings/backup-restore?incoming=${encodeURIComponent(uri)}`);
    expect(redirectSystemPath({ path: "file:///storage/emulated/0/Download/arth-backup.arth", initial: false })).toMatch(
      /^\/settings\/backup-restore\?incoming=file/,
    );
  });

  it("leaves every other link alone (the Kite login return, routes)", () => {
    expect(redirectSystemPath({ path: "artha://kite-callback?request_token=x", initial: false })).toBe("artha://kite-callback?request_token=x");
    expect(redirectSystemPath({ path: "/settings/merchants", initial: false })).toBe("/settings/merchants");
  });
});
