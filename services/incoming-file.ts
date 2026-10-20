/**
 * A backup file opened with Arth ("Open with"), held until the app can show it.
 *
 * Android hands the file's address over at once, but on a cold start the root layout is still on
 * the splash screen (no screens to route to yet), and the biometric lock then replaces everything
 * with the lock screen and afterwards Home. Routing straight to Restore lost the file either way.
 * So app/+native-intent.tsx parks it here; the root layout opens Restore once the app is ready and
 * unlocked, and the lock screen does so after unlocking.
 */

let pending: string | null = null;
const listeners = new Set<() => void>();

export function setIncomingFile(uri: string): void {
  pending = uri;
  listeners.forEach((l) => l());
}

/** The waiting file, if any - taken, so it's opened once. */
export function takeIncomingFile(): string | null {
  const uri = pending;
  pending = null;
  return uri;
}

export function hasIncomingFile(): boolean {
  return pending != null;
}

export function onIncomingFile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function restoreHrefFor(uri: string): string {
  return `/settings/backup-restore?incoming=${encodeURIComponent(uri)}`;
}
