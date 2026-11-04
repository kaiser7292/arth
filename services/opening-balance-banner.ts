import { settingsStorage } from "@/services/storage";

/**
 * Accounts whose "No opening balance set" banner the user has dismissed. Per account, so an account
 * added later still warns once. The balance screens still show the ₹0 opening either way.
 */
const DISMISSED_KEY = "opening_balance_banner_dismissed";

function dismissedIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(settingsStorage.getString(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function isOpeningBannerDismissed(accountId: string): boolean {
  return dismissedIds().includes(accountId);
}

export function dismissOpeningBanner(accountId: string): void {
  const ids = dismissedIds();
  if (!ids.includes(accountId)) settingsStorage.set(DISMISSED_KEY, JSON.stringify([...ids, accountId]));
}
