/**
 * Links Android hands to Arth before Expo Router reads them as a route.
 *
 * A backup opened from a file manager, Downloads or an attachment ("Open with Arth") arrives as a
 * content:// or file:// address. It isn't a screen, so it's sent to Backup & Restore with the
 * file attached (app/settings/backup-restore.tsx), where it's checked and restored only after the
 * password and a confirmation. Every other link passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(content|file):\/\//i.test(path)) {
      return `/settings/backup-restore?incoming=${encodeURIComponent(path)}`;
    }
  } catch {
    // Fall through to the default handling.
  }
  return path;
}
