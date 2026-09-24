import { settingsStorage } from '@/services/storage';
import { decryptCustomFields, decryptField, getVaultEntries, getVaultEntry, type VaultEntry } from '@/services/vault';

const MMKV_KITE_VAULT_ENTRY = 'kite_login_vault_entry_id';

export interface KiteLoginSecrets {
  userId: string;
  password: string;
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

/** Vault entries that can log in to Kite: need a login ID and a password. */
export async function getKiteLoginCandidates(): Promise<VaultEntry[]> {
  const entries = await getVaultEntries();
  return entries.filter((e) => e.password_enc && loginIdOf(e));
}

export async function getKiteLoginSecrets(entryId: string): Promise<KiteLoginSecrets | null> {
  const entry = await getVaultEntry(entryId);
  if (!entry?.password_enc) return null;
  const userId = loginIdOf(entry);
  const password = await decryptField(entry.password_enc);
  if (!userId || !password) return null;
  const custom = await decryptCustomFields(entry.custom_fields);
  return { userId, password, totpSecret: custom.totp_secret || null };
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

export function buildLoginFillJs(userId: string, password: string): string {
  return `
(function () {
  ${SET_VALUE_JS}
  var uid = document.getElementById('userid');
  if (uid && !uid.value) __arthSet(uid, ${JSON.stringify(userId)});
  __arthSet(document.getElementById('password'), ${JSON.stringify(password)});
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
