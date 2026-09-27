import { settingsStorage } from "@/services/storage";
import {
  createVaultEntry,
  decryptCustomFields,
  decryptField,
  getVaultEntry,
  searchVaultEntries,
  updateVaultEntry,
  type VaultEntry,
  type VaultEntryInput,
} from "@/services/vault";

/**
 * Broker credentials <-> Vault.
 *
 * Broker secrets (API keys, API secrets, TOTP secrets, passwords) live in the device's secure
 * storage and are deliberately NOT in backups. The Vault is, encrypted - so saving them to the
 * Vault is how they survive a phone change: back up, restore, then "Fill from Vault" on the
 * broker's screen.
 *
 * Extra secrets go in the entry's custom fields under the Vault's own names (api_key,
 * api_secret, totp_secret) so the Vault screens can show and edit them. Angel's first
 * "Save to Vault" used "API Key" / "TOTP Secret", which the Vault never displayed -
 * normalizeCustomFields reads those too.
 */

export type VaultBroker = "kite" | "angel" | "zebpay";

export interface BrokerSecrets {
  /** Login / client ID (Angel). */
  clientId?: string;
  /** Login password or MPIN (Angel). */
  password?: string;
  apiKey?: string;
  apiSecret?: string;
  totpSecret?: string;
}

const SPECS: Record<VaultBroker, { title: string; url: string; notes: string; search: string }> = {
  kite: {
    title: "Zerodha Kite",
    url: "https://developers.kite.trade/apps",
    notes: "Kite Connect credentials used by Arth for portfolio sync",
    search: "Zerodha Kite",
  },
  angel: {
    title: "Angel One SmartAPI",
    url: "https://smartapi.angelone.in",
    notes: "Angel One SmartAPI credentials used by Arth for portfolio sync",
    search: "Angel One",
  },
  zebpay: {
    title: "ZebPay API",
    url: "https://www.zebpay.com",
    notes: "ZebPay API credentials used by Arth for portfolio sync",
    search: "ZebPay",
  },
};

const LEGACY_KEYS: Record<string, string> = {
  "API Key": "api_key",
  "API Secret": "api_secret",
  "Secret Key": "api_secret",
  "TOTP Secret": "totp_secret",
};

/** Custom fields with legacy display-name keys mapped to the Vault's own keys. Pure. */
export function normalizeCustomFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = LEGACY_KEYS[k] ?? k;
    if (v && !out[key]) out[key] = v;
  }
  return out;
}

/** Which Vault entry holds this broker's credentials (backed up - it points into the database). */
const ENTRY_KEY = (broker: VaultBroker) => `broker_vault_entry__${broker}`;
const KITE_LOGIN_ENTRY = "kite_login_vault_entry_id";

async function findEntry(broker: VaultBroker): Promise<VaultEntry | null> {
  const remembered = settingsStorage.getString(ENTRY_KEY(broker));
  if (remembered) {
    const e = await getVaultEntry(remembered);
    if (e) return e;
  }
  // Kite: the entry already picked for "Login from Vault" is the natural home for the API key.
  if (broker === "kite") {
    const loginId = settingsStorage.getString(KITE_LOGIN_ENTRY);
    const e = loginId ? await getVaultEntry(loginId) : null;
    if (e) return e;
  }
  const matches = await searchVaultEntries(SPECS[broker].search);
  return matches.find((e) => e.category === "demat") ?? matches[0] ?? null;
}

/** True when the Vault has an entry for this broker. */
export async function hasBrokerVaultEntry(broker: VaultBroker): Promise<boolean> {
  return (await findEntry(broker)) != null;
}

/**
 * Save (or update) this broker's credentials in the Vault. Only the given, non-empty values
 * are written; everything else already on the entry is kept.
 */
export async function saveBrokerSecretsToVault(
  broker: VaultBroker,
  secrets: BrokerSecrets,
): Promise<{ entryId: string; created: boolean }> {
  const spec = SPECS[broker];
  const clean = (v?: string) => (v ?? "").trim() || undefined;
  const extras: Record<string, string> = {};
  if (clean(secrets.apiKey)) extras.api_key = clean(secrets.apiKey)!;
  if (clean(secrets.apiSecret)) extras.api_secret = clean(secrets.apiSecret)!;
  if (clean(secrets.totpSecret)) extras.totp_secret = clean(secrets.totpSecret)!.replace(/[\s=]/g, "").toUpperCase();

  const existing = await findEntry(broker);
  if (existing) {
    const current = normalizeCustomFields(await decryptCustomFields(existing.custom_fields));
    // updateVaultEntry nulls text columns it isn't given, so pass the entry's own values back.
    const input: Partial<VaultEntryInput> = {
      title: existing.title,
      category: existing.category,
      login_method: existing.login_method,
      username: clean(secrets.clientId) ?? existing.username ?? undefined,
      email: existing.email ?? undefined,
      phone: existing.phone ?? undefined,
      url: existing.url ?? undefined,
      notes: existing.notes ?? undefined,
      renewal_date: existing.renewal_date ?? undefined,
      linked_account_id: existing.linked_account_id ?? undefined,
      custom_fields_data: { ...current, ...extras },
    };
    if (clean(secrets.password)) input.password = clean(secrets.password);
    await updateVaultEntry(existing.id, input);
    settingsStorage.set(ENTRY_KEY(broker), existing.id);
    return { entryId: existing.id, created: false };
  }

  const entryId = await createVaultEntry({
    title: spec.title,
    category: "demat",
    login_method: clean(secrets.clientId) || clean(secrets.password) ? "password" : "none",
    username: clean(secrets.clientId),
    password: clean(secrets.password),
    url: spec.url,
    notes: spec.notes,
    custom_fields_data: extras,
  });
  settingsStorage.set(ENTRY_KEY(broker), entryId);
  return { entryId, created: true };
}

/** This broker's credentials from the Vault, or null when there's no entry. */
export async function loadBrokerSecretsFromVault(broker: VaultBroker): Promise<BrokerSecrets | null> {
  const entry = await findEntry(broker);
  if (!entry) return null;
  const cf = normalizeCustomFields(await decryptCustomFields(entry.custom_fields));
  const password = entry.password_enc ? await decryptField(entry.password_enc) : "";
  // The old Kite "Save to Vault" put the API key in the password field ("Zerodha Kite API").
  if (broker === "kite" && !cf.api_key && entry.title === "Zerodha Kite API") {
    return { apiKey: password || undefined };
  }
  return {
    clientId: entry.username || entry.phone || entry.email || undefined,
    password: password || undefined,
    apiKey: cf.api_key,
    apiSecret: cf.api_secret,
    totpSecret: cf.totp_secret,
  };
}
