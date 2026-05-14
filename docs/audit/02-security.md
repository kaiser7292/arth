# Security Audit

## Quick Wins (Low Effort, High Impact)

### 🔴 CRITICAL — Hardcoded `localhost:3000` backend URL in kite-connect
**File:** `services/kite-connect.ts` line 7  
```ts
const BACKEND_URL = 'http://localhost:3000'; // Change this to your backend URL
```
**Impact:** Any Kite OAuth token exchange will silently fail (or worse, send tokens to an unintended local server if the device somehow reaches port 3000). HTTP (not HTTPS) is also a risk for token interception.  
**User / UX Impact:** Tapping "Connect Zerodha" completes the OAuth browser flow and redirects back to the app — but the token exchange request silently hits localhost:3000 and fails. The user sees either a network error toast or is left on a loading spinner indefinitely. Their Zerodha portfolio never links and they have no idea why. There is no error message explaining the root cause.  
**Fix:** Move to an env/config constant (or `app.json` `extra` field). Enforce HTTPS. At minimum add a runtime guard that throws if `BACKEND_URL` is still localhost in a production build.

---

### 🟡 HIGH — UUID fallback uses `Math.random()` (not CSPRNG)
**File:** `utils/uuid.ts` lines 14–18  
**Issue:** When `crypto.randomUUID()` is unavailable, the fallback generates UUIDs with `Math.random()`. On React Native (Hermes), `crypto.randomUUID` is available, but the fallback path still exists and uses a predictable PRNG. UUIDs are used as primary keys for expenses, hisaab entries, etc. — predictable IDs could enable enumeration attacks if any IDs are ever exposed.  
**User / UX Impact:** No directly visible impact in normal use. The risk is latent: if IDs are ever shared (e.g. exported in a hisaab Excel, a backup file inspected by someone, or if a future sync feature exposes IDs over a network), a pattern in the IDs could let an attacker infer the sequence and enumerate other records. On the user-facing side there is no change in behavior.  
**Fix:** Replace the `Math.random()` fallback with `expo-crypto`'s `getRandomBytes()`, which is already a dependency.

---

### 🟡 HIGH — Biometric lock bypass possible via cold-start race
**File:** `app/_layout.tsx` lines 243–259  
**Issue:** The lock evaluation runs only after `dbReady && minSplashDone`. The `minSplashDone` timer is a fixed 800ms — if DB init finishes in < 800ms, there is a brief window where the app is fully loaded but the lock hasn't fired yet. An attacker with physical access and fast device could screenshot/record during this window.  
**User / UX Impact:** On fast flagship devices (Pixel 8, Samsung S24), DB init completes in ~200–300ms. For ~500ms the Home screen with balances, account numbers, and transaction history is briefly visible before the lock screen appears. A person with physical access to an unlocked device could see sensitive financial data in that window even with biometric lock enabled. The user believes the lock is instant but it is not.  
**Fix:** Gate the UI render behind both `dbReady && minSplashDone && lockEvaluated` (add a third state bit that's set after `evaluateLock()` runs).

---

### 🟡 HIGH — `routerRef.current = useRouter()` inside try/catch (rules of hooks violation)
**File:** `app/_layout.tsx` lines 150–154  
```tsx
try {
  routerRef.current = useRouter();
} catch (e) { ... }
```
**Issue:** React hooks must not be called inside try/catch. This violates the Rules of Hooks and can cause React to silently misorder hooks across renders, leading to subtle state corruption bugs.  
**User / UX Impact:** React's hook ordering is based on call order, not conditionals. A try/catch can conditionally suppress a hook call, causing React to mismatch hook state on re-renders. In practice this can produce: navigation actions that silently no-op (a button tap does nothing), the app navigating to the wrong screen after an action, or a "Rendered more hooks than previous render" crash that completely white-screens the app. This is the root layout, so any navigation bug here affects the entire app.  
**Fix:** Call `useRouter()` unconditionally at the top of the component (it is guaranteed to be available inside Expo Router's `<Stack>`). Remove the try/catch wrapper.

---

### 🟡 MEDIUM — Backup file written to cache directory (world-readable on rooted devices)
**File:** `services/backup.ts` line 331  
```ts
const backupFile = new File(Paths.cache, fileName);
```
**Issue:** `Paths.cache` is accessible to other processes on rooted Android devices. The file is encrypted, so the risk is mitigated, but writing to `Paths.documents` or deleting from cache immediately after sharing is better practice.  
**User / UX Impact:** For non-rooted devices: no impact. On a rooted device, a malicious app with root access could read the backup file from cache before it is shared/deleted. The file is AES-256-GCM encrypted so it cannot be read without the passphrase, but the ciphertext is exposed. If the sharing intent is cancelled by the user (they dismiss the share sheet), the backup file is NOT deleted and persists in cache indefinitely — the user's encrypted financial archive sits in a world-accessible directory until the OS cache-purges it.  
**Fix:** `shareBackup()` already calls `tempFile.delete()` after sharing — ensure this path is always exercised and not just when `Sharing.isAvailableAsync()` is true.

---

### 🟡 MEDIUM — `LEGACY_V2_KEY_ITERATIONS = 100000` variable name mismatches its use
**File:** `services/backup.ts` line 52  
**Issue:** The variable is named `LEGACY_V2_KEY_ITERATIONS` but comment says "For restoring V2 backups created before v5.1". The actual fallback label in code at line 525 says "pre-v5.1". The `legacyDeriveKey` function (V1 XOR format) uses this constant, but it is actually used for the **V2** 100k-iteration fallback path (line 527). Both the naming and the comment mismatch creates confusion during future security review.  
**User / UX Impact:** No direct user impact. The risk is developer confusion: if someone refactors the backup restore paths and uses the wrong constant for the wrong legacy path, a user restoring an old V1/V2 backup would get a "wrong passphrase" error even when entering the correct password — effectively making old backups unrestorable with no clear explanation.  
**Fix:** Rename to `LEGACY_V2_AES_KEY_ITERATIONS` and update comments to match.

---

### 🟡 MEDIUM — SMS permission declared but READ_SMS is a dangerous permission (no runtime rationale shown)
**File:** `app.json` line 21  
**Issue:** `android.permission.READ_SMS` is declared. On Android 6+, this is a dangerous runtime permission. There is no evidence in the codebase of a rationale dialog explaining why SMS is needed before the permission request fires.  
**User / UX Impact:** When the SMS permission dialog appears with no prior explanation, users who don't understand why a finance app needs to read SMS messages often deny it. Once denied, the OS permission dialog cannot be shown again — the user must go to system Settings to re-enable it manually, which most users don't do. The result is that SMS auto-import (a core feature) is permanently disabled for those users with no guidance. A pre-permission rationale screen explaining "Artha reads bank SMS to auto-import transactions" dramatically increases grant rates.  
**Fix:** In the SMS scan flow, show an explicit rationale dialog (using `PermissionsAndroid.request` rationale option or a custom pre-permission screen) before requesting.

---

### 🟢 LOW — `MAGIC_HEADER` length assertion only runs in `__DEV__`
**File:** `services/backup.ts` line 46  
```ts
if (__DEV__ && MAGIC_HEADER.length !== 9) { throw new Error(...) }
```
**Issue:** This is a compile-time constant — the guard is redundant in prod but also harmless. More importantly, if someone edits `MAGIC_HEADER` in a future refactor, the production guard won't catch it.  
**User / UX Impact:** None currently. If `MAGIC_HEADER` were accidentally changed in a future commit without dev testing, production backup files would have a wrong header signature — all restore attempts on existing backups would fail with "not a valid backup file" even on valid backups. The guard being dev-only means this regression would ship silently.  
**Fix:** Change to `if (MAGIC_HEADER.length !== 9) throw new Error(...)` unconditionally (it's a constant that's always known at build time — no runtime cost).

---

### 🟢 LOW — Kite access token + API key stored in SecureStore but public_token stored alongside
**File:** `services/kite-connect.ts` lines 40–42  
**Issue:** `public_token` is the TOTP seed equivalent in Kite's auth flow and should be treated like the access token. It already is stored in SecureStore — but there is no token expiry check or automatic clearing on session timeout.  
**User / UX Impact:** Kite access tokens expire daily. If the user opens the portfolio screen the next day with a stale token, the API call will return a 403 error. Without auto-clearing, the app may silently show the last cached portfolio value or show an error with no "reconnect" prompt. The user has no way to know their Zerodha data is stale without manually navigating to the connection settings and re-authenticating.  
**Fix:** Add a `clearKiteCredentials()` call when the app detects a Kite API error (401/403 response) so stale tokens don't linger.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🔴 Critical | Hardcoded localhost:3000 URL | kite-connect.ts | 30 min |
| 🟡 High | UUID fallback uses Math.random | uuid.ts | 10 min |
| 🟡 High | Biometric lock cold-start race window | app/_layout.tsx | 20 min |
| 🟡 High | useRouter() inside try/catch (hooks violation) | app/_layout.tsx | 5 min |
| 🟡 Medium | Backup written to cache (rooted device risk) | backup.ts | 10 min |
| 🟡 Medium | LEGACY constant naming confusion | backup.ts | 5 min |
| 🟡 Medium | No SMS permission rationale dialog | SMS scan flow | 30 min |
| 🟢 Low | __DEV__-only MAGIC_HEADER guard | backup.ts | 2 min |
| 🟢 Low | Kite token expiry not handled | kite-connect.ts | 20 min |
