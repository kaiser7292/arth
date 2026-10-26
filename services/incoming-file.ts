/**
 * Something handed to Arth from another app, held until the app can show it:
 *   - a backup opened with Arth ("Open with")        -> Backup & Restore
 *   - an image shared to Arth (a payment screenshot) -> Add from screenshot
 *   - text shared to Arth (a payment message)        -> Add from screenshot, read as text
 *
 * It arrives at once, but on a cold start the root layout is still on the splash screen (no screens
 * to route to yet), and the biometric lock then replaces everything with the lock screen and
 * afterwards Home. So it's parked here; the root layout opens it once the app is ready and
 * unlocked, and the lock screen does so after unlocking.
 */

export type Incoming = { kind: "backup"; uri: string } | { kind: "image"; uri: string } | { kind: "text"; text: string };

let pending: Incoming | null = null;
const listeners = new Set<() => void>();

export function setIncoming(item: Incoming): void {
  pending = item;
  listeners.forEach((l) => l());
}

/** Back-compat for "Open with" backups. */
export function setIncomingFile(uri: string): void {
  setIncoming({ kind: "backup", uri });
}

/** The waiting item, if any - taken, so it's opened once. */
export function takeIncoming(): Incoming | null {
  const item = pending;
  pending = null;
  return item;
}

export function hasIncoming(): boolean {
  return pending != null;
}

export function onIncoming(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Where an incoming item opens. Shares carry a one-off `at` so each opens as its own screen: a
 * second share while the first one's screen is still up (share, switch back to the payment app,
 * share the next) otherwise pointed at an identical address and nothing new opened.
 */
export function hrefForIncoming(item: Incoming): string {
  if (item.kind === "backup") return `/settings/backup-restore?incoming=${encodeURIComponent(item.uri)}`;
  const at = `&at=${Date.now()}`;
  if (item.kind === "image") return `/expense/from-screenshot?uri=${encodeURIComponent(item.uri)}${at}`;
  return `/expense/from-screenshot?text=${encodeURIComponent(item.text.slice(0, 2000))}${at}`;
}
