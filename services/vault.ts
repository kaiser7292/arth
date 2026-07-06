import { getDatabase } from "@/database";
import * as SecureStore from "expo-secure-store";
import Aes from "react-native-aes-crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VaultCategory =
  | "banking"
  | "card"
  | "upi"
  | "demat"
  | "investment"
  | "insurance"
  | "email"
  | "gaming"
  | "subscription"
  | "social"
  | "other";

export type LoginMethod =
  | "password"       // username + password
  | "email_password" // email + password
  | "google"         // just which Google account (email field)
  | "apple"          // just which Apple ID (email field)
  | "phone_otp"      // phone number only (OTP-based, no password)
  | "pin"            // PIN only
  | "none";          // no credentials — notes/customer care

export interface VaultEntry {
  id: string;
  title: string;
  category: VaultCategory;
  login_method: LoginMethod;
  username: string | null;
  email: string | null;
  phone: string | null;
  password_enc: string | null;
  pin_enc: string | null;
  url: string | null;
  notes: string | null;
  custom_fields: string | null;
  renewal_date: string | null;
  linked_account_id: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface VaultEntryInput {
  title: string;
  category: VaultCategory;
  login_method: LoginMethod;
  username?: string;
  email?: string;
  phone?: string;
  password?: string;
  pin?: string;
  url?: string;
  notes?: string;
  renewal_date?: string;
  linked_account_id?: string;
}

export const VAULT_CATEGORY_LABELS: Record<VaultCategory, string> = {
  banking:      "Net Banking",
  card:         "Credit / Debit Card",
  upi:          "UPI",
  demat:        "Demat / Trading",
  investment:   "Investment",
  insurance:    "Insurance",
  email:        "Email",
  gaming:       "Gaming",
  subscription: "Subscription",
  social:       "Social",
  other:        "Other",
};

export const VAULT_CATEGORY_ICONS: Record<VaultCategory, string> = {
  banking:      "business-outline",
  card:         "card-outline",
  upi:          "phone-portrait-outline",
  demat:        "trending-up-outline",
  investment:   "bar-chart-outline",
  insurance:    "shield-checkmark-outline",
  email:        "mail-outline",
  gaming:       "game-controller-outline",
  subscription: "play-circle-outline",
  social:       "people-outline",
  other:        "ellipsis-horizontal-circle-outline",
};

export const VAULT_CATEGORY_GROUPS: { label: string; categories: VaultCategory[] }[] = [
  { label: "Finance", categories: ["banking", "card", "upi", "demat", "investment", "insurance"] },
  { label: "Personal", categories: ["email", "gaming", "subscription", "social", "other"] },
];

export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  password:       "Username + Password",
  email_password: "Email + Password",
  google:         "Sign in with Google",
  apple:          "Sign in with Apple",
  phone_otp:      "Phone OTP (no password)",
  pin:            "PIN only",
  none:           "No credentials",
};

// ─── Crypto ───────────────────────────────────────────────────────────────────

const VAULT_KEY_STORE = "arth_vault_master_key";

async function getVaultKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(VAULT_KEY_STORE);
  if (!key) {
    key = await Aes.randomKey(32);
    await SecureStore.setItemAsync(VAULT_KEY_STORE, key);
  }
  return key;
}

export async function encryptField(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  const key = await getVaultKey();
  const iv = await Aes.randomKey(16);
  const ct = await Aes.encrypt(plaintext, key, iv, "aes-256-cbc");
  return JSON.stringify({ iv, ct });
}

export async function decryptField(encrypted: string): Promise<string> {
  if (!encrypted) return "";
  try {
    const key = await getVaultKey();
    const { iv, ct } = JSON.parse(encrypted) as { iv: string; ct: string };
    return await Aes.decrypt(ct, key, iv, "aes-256-cbc");
  } catch {
    return "";
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `vault_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function createVaultEntry(input: VaultEntryInput): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  const password_enc = input.password ? await encryptField(input.password) : null;
  const pin_enc = input.pin ? await encryptField(input.pin) : null;

  await db.runAsync(
    `INSERT INTO vault_entries
     (id, title, category, login_method, username, email, phone,
      password_enc, pin_enc, url, notes, renewal_date, linked_account_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title.trim(),
      input.category,
      input.login_method,
      input.username?.trim() || null,
      input.email?.trim() || null,
      input.phone?.trim() || null,
      password_enc,
      pin_enc,
      input.url?.trim() || null,
      input.notes?.trim() || null,
      input.renewal_date || null,
      input.linked_account_id || null,
      now,
    ],
  );
  return id;
}

export async function getVaultEntries(): Promise<VaultEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<VaultEntry>(
    `SELECT * FROM vault_entries WHERE deleted_at IS NULL ORDER BY title ASC`,
  );
}

export async function getVaultEntry(id: string): Promise<VaultEntry | null> {
  const db = getDatabase();
  return db.getFirstAsync<VaultEntry>(
    `SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
}

export async function updateVaultEntry(
  id: string,
  input: Partial<VaultEntryInput> & { password?: string; pin?: string },
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const password_enc =
    input.password !== undefined
      ? input.password
        ? await encryptField(input.password)
        : null
      : undefined;
  const pin_enc =
    input.pin !== undefined
      ? input.pin
        ? await encryptField(input.pin)
        : null
      : undefined;

  const sets: string[] = ["updated_at = ?"];
  const vals: (string | null)[] = [now];

  const fields: [string, string | null | undefined][] = [
    ["title", input.title?.trim()],
    ["category", input.category],
    ["login_method", input.login_method],
    ["username", input.username?.trim() ?? null],
    ["email", input.email?.trim() ?? null],
    ["phone", input.phone?.trim() ?? null],
    ["password_enc", password_enc],
    ["pin_enc", pin_enc],
    ["url", input.url?.trim() ?? null],
    ["notes", input.notes?.trim() ?? null],
    ["renewal_date", input.renewal_date ?? null],
    ["linked_account_id", input.linked_account_id ?? null],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(val);
    }
  }

  vals.push(id);
  await db.runAsync(
    `UPDATE vault_entries SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    vals as string[],
  );
}

export async function deleteVaultEntry(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE vault_entries SET deleted_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
}

export async function searchVaultEntries(query: string): Promise<VaultEntry[]> {
  const db = getDatabase();
  const q = `%${query.toLowerCase()}%`;
  return db.getAllAsync<VaultEntry>(
    `SELECT * FROM vault_entries
     WHERE deleted_at IS NULL
       AND (LOWER(title) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(url) LIKE ?)
     ORDER BY title ASC`,
    [q, q, q, q],
  );
}
