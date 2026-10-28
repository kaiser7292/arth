import { setIncoming, setIncomingFile } from "@/services/incoming-file";

/**
 * Screens the home-screen widgets open (components/widget/ArthWidgets.tsx). When a widget button
 * starts Arth, the link is lost: the root layout shows only the splash until it knows whether to
 * lock, and the navigator then starts on Home. These are parked and opened once Arth is ready.
 */
const WIDGET_PATHS = new Set(["/expense/add", "/expense/from-screenshot", "/expense/catch-up", "/budget", "/?voice=1"]);

/** "artha://expense/add" -> "/expense/add", "artha://?voice=1" -> "/?voice=1". */
export function appPath(link: string): string {
  const rest = link.replace(/^artha:\/\/\/?/i, "");
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * Links Android hands to Arth before Expo Router reads them as a route.
 *
 * A backup opened from a file manager, Downloads or an attachment ("Open with Arth") arrives as a
 * content:// or file:// address. It isn't a screen: it's parked (services/incoming-file.ts) and
 * the app stays where it is. The root layout opens Backup & Restore with it once the app is ready
 * and unlocked - routing to Restore here was lost behind the splash and lock screens. A widget
 * button that starts Arth is parked the same way. Every other link passes through unchanged.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    // A share from another app on iPhone opens Arth with artha://dataUrl=...: the share hook in the
    // root layout reads it; there's no screen by that name.
    if (path.includes("dataUrl=")) return "/";
    if (/^(content|file):\/\//i.test(path)) {
      setIncomingFile(path);
      return "/";
    }
    if (initial && WIDGET_PATHS.has(appPath(path))) {
      setIncoming({ kind: "link", href: appPath(path) });
      return "/";
    }
  } catch {
    // Fall through to the default handling.
  }
  return path;
}
