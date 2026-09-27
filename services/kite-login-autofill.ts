import { settingsStorage } from '@/services/storage';
import { decryptCustomFields, decryptField, getVaultEntries, getVaultEntry, type VaultEntry } from '@/services/vault';
import { normalizeCustomFields } from '@/services/broker-vault';

const MMKV_KITE_VAULT_ENTRY = 'kite_login_vault_entry_id';

/** Any of these may be missing: Arth fills what it has and the user types the rest. */
export interface KiteLoginSecrets {
  userId: string | null;
  password: string | null;
  totpSecret: string | null;
}

export function getKiteVaultEntryId(): string | null {
  return settingsStorage.getString(MMKV_KITE_VAULT_ENTRY) ?? null;
}

export function setKiteVaultEntryId(id: string | null): void {
  if (id) settingsStorage.set(MMKV_KITE_VAULT_ENTRY, id);
  else settingsStorage.delete(MMKV_KITE_VAULT_ENTRY);
}

function loginIdOf(entry: VaultEntry): string | null {
  return entry.username || entry.phone || entry.email || null;
}

async function totpSecretOf(entry: VaultEntry): Promise<string | null> {
  if (!entry.custom_fields) return null;
  return normalizeCustomFields(await decryptCustomFields(entry.custom_fields)).totp_secret || null;
}

/** Vault entries that can help log in to Kite: a login ID and password, or a TOTP key. */
export async function getKiteLoginCandidates(): Promise<VaultEntry[]> {
  const entries = await getVaultEntries();
  const out: VaultEntry[] = [];
  for (const e of entries) {
    if ((e.password_enc && loginIdOf(e)) || (await totpSecretOf(e))) out.push(e);
  }
  return out;
}

export async function getKiteLoginSecrets(entryId: string): Promise<KiteLoginSecrets | null> {
  const entry = await getVaultEntry(entryId);
  if (!entry) return null;
  const userId = loginIdOf(entry);
  const password = entry.password_enc ? (await decryptField(entry.password_enc)) || null : null;
  const totpSecret = await totpSecretOf(entry);
  return userId || password || totpSecret ? { userId, password, totpSecret } : null;
}

/** Only ever hand credentials to Zerodha's own login host. */
export function isKiteLoginUrl(url: string | undefined): boolean {
  return !!url && /^https:\/\/kite\.zerodha\.com(?:[/?#]|$)/.test(url);
}

// Injected on every page load. Holds no secrets — it only tells Arth which
// step of the login is showing, and Arth then injects the matching values.
export const KITE_LOGIN_WATCHER_JS = `
(function () {
  if (window.__arthKiteWatcher) return;
  window.__arthKiteWatcher = true;
  var asked = {};
  function post(type) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ arth: 'kite-login', type: type }));
  }
  function usable(el) { return !!el && el.offsetParent !== null && !el.disabled && !el.readOnly; }
  function totpInput() {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!usable(el) || el.type === 'password' || el.type === 'hidden') continue;
      if (el.type === 'number' || el.inputMode === 'numeric' || el.maxLength === 6) return el;
    }
    return null;
  }
  setInterval(function () {
    var pw = document.getElementById('password');
    if (usable(pw)) {
      if (!pw.value && !asked.login) { asked.login = true; post('login_form'); }
      return;
    }
    var t = totpInput();
    if (t && !t.value && !asked.totp) { asked.totp = true; post('totp_form'); }
  }, 400);
})();
true;
`;

const SET_VALUE_JS = `
function __arthSet(el, v) {
  if (!el) return false;
  var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
`;

export function buildLoginFillJs(userId: string | null, password: string | null): string {
  return `
(function () {
  ${SET_VALUE_JS}
  var uid = document.getElementById('userid');
  var userId = ${JSON.stringify(userId ?? '')};
  var password = ${JSON.stringify(password ?? '')};
  if (userId && uid && !uid.value) __arthSet(uid, userId);
  if (password) __arthSet(document.getElementById('password'), password);
})();
true;
`;
}

export function buildTotpFillJs(code: string): string {
  return `
(function () {
  ${SET_VALUE_JS}
  var inputs = document.querySelectorAll('input');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (el.offsetParent === null || el.disabled || el.readOnly || el.type === 'password' || el.type === 'hidden') continue;
    if (el.type === 'number' || el.inputMode === 'numeric' || el.maxLength === 6) { __arthSet(el, ${JSON.stringify(code)}); break; }
  }
})();
true;
`;
}
