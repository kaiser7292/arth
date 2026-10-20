import { setIncomingFile } from "@/services/incoming-file";

/**
 * Links Android hands to Arth before Expo Router reads them as a route.
 *
 * A backup opened from a file manager, Downloads or an attachment ("Open with Arth") arrives as a
 * content:// or file:// address. It isn't a screen: it's parked (services/incoming-file.ts) and
 * the app stays where it is. The root layout opens Backup & Restore with it once the app is ready
 * and unlocked - routing to Restore here was lost behind the splash and lock screens. Every other
 * link passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(content|file):\/\//i.test(path)) {
      setIncomingFile(path);
      return "/";
    }
  } catch {
    // Fall through to the default handling.
  }
  return path;
}
