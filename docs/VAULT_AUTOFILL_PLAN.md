# Arth Vault — Android Autofill Service
## Execution Plan

**Feature:** Fill card numbers, passwords, UPI IDs, and other vault credentials into any Android app or browser directly from Arth — without leaving the app you're using.

**Status:** Planned (post-v2.x)
**Estimated effort:** 3–4 weeks (native Android + React Native bridge)
**Version target:** v3.0.0

---

## 1. What It Is

Android's [Autofill Framework](https://developer.android.com/guide/topics/text/autofill) (API 26+) lets an app register as the system autofill provider. Once set, when any text field is focused in any app, Android asks Arth: "What should fill this?" Arth can respond with suggestions drawn from the Vault.

The user sees a small banner above the keyboard or a dropdown — identical to how Bitwarden or Google Autofill work.

**What Arth can autofill once built:**

| Vault field | Android autofill hint | Example use |
|---|---|---|
| Card number | `AUTOFILL_HINT_CREDIT_CARD_NUMBER` | Online checkout |
| Card expiry | `AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_DATE` | Online checkout |
| CVV | `AUTOFILL_HINT_CREDIT_CARD_SECURITY_CODE` | Online checkout |
| ATM/card PIN | `AUTOFILL_HINT_PIN` | Bank app |
| Password | `AUTOFILL_HINT_PASSWORD` | Any login |
| Username | `AUTOFILL_HINT_USERNAME` | Any login |
| Email | `AUTOFILL_HINT_EMAIL_ADDRESS` | Any login |
| Phone | `AUTOFILL_HINT_PHONE` | Any form |
| UPI ID | *(custom hint or username)* | UPI apps |

**What it cannot do:** iOS (different system), browser extensions, auto-submit forms, OTP detection (SMS OTP is a separate Android API).

---

## 2. How Android Autofill Works (Architecture)

```
User focuses a field in Bank App
            │
     Android Framework
            │
     calls ArthAutofillService.onFillRequest()
            │
     Service inspects the AssistStructure (view hierarchy)
     → finds field hints (password, card number, etc.)
            │
     Service has two choices:
     ┌──────────────────────────────────────────────┐
     │  A. Inline fill (no auth needed)             │
     │     → Return Dataset with plaintext values   │
     │     → Used for non-sensitive fields          │
     └──────────────────────────────────────────────┘
     ┌──────────────────────────────────────────────┐
     │  B. Auth-gated fill (sensitive fields)       │
     │     → Return Dataset with auth Intent        │
     │     → User sees "Tap to fill with Arth"      │
     │     → Tapping opens ArthAutofillPickerActivity│
     │     → Biometric prompt shown                 │
     │     → User picks vault entry                 │
     │     → Activity returns fill data to service  │
     └──────────────────────────────────────────────┘
            │
     Android fills the fields
```

All sensitive fields (password, card number, CVV, PIN) go through path B. Only non-sensitive fields (username, email if not a password field, URL) may use path A.

---

## 3. New Files

### 3.1 Native Android (Kotlin)

```
android/app/src/main/java/com/souravbaid/artha/
├── autofill/
│   ├── ArthAutofillService.kt        — Main AutofillService
│   ├── ArthAutofillPickerActivity.kt — Native UI for vault selection + biometric
│   ├── VaultDbReader.kt              — Reads vault entries from SQLite (titles only)
│   ├── VaultDecryptor.kt             — Decrypts vault fields using Keystore key
│   └── FieldHintDetector.kt          — Maps AssistStructure hints → field types
```

### 3.2 Android Resources

```
android/app/src/main/res/
├── xml/
│   └── autofill_service_config.xml   — Declares supported hints to Android
└── layout/
    └── activity_autofill_picker.xml  — Native RecyclerView for vault list
```

### 3.3 Expo Config Plugin

```
plugins/
└── withAutofillService.ts            — Registers service + activity in AndroidManifest
```

### 3.4 Arth App Side (TypeScript)

```
services/
└── vault-autofill-prefs.ts           — MMKV: per-app package → preferred vault entry
                                         (remembers "Bank XYZ app → my HDFC card")
```

---

## 4. Implementation Details

### 4.1 ArthAutofillService.kt

```kotlin
class ArthAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val structure = request.fillContexts.last().structure
        val fields = FieldHintDetector.detect(structure)

        if (fields.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        // Build auth-gated dataset — always require biometric for vault data
        val authIntent = Intent(this, ArthAutofillPickerActivity::class.java).apply {
            putExtra(EXTRA_FIELD_TYPES, fields.map { it.name }.toTypedArray())
            putExtra(EXTRA_CLIENT_STATE, request.clientState)
        }
        val authPI = PendingIntent.getActivity(this, 0, authIntent, PendingIntent.FLAG_MUTABLE)

        val presentation = RemoteViews(packageName, R.layout.autofill_suggestion).apply {
            setTextViewText(R.id.suggestion_text, "Fill with Arth Vault")
        }

        val dataset = Dataset.Builder(presentation)
            .setAuthentication(authPI.intentSender)
            .build()

        callback.onSuccess(FillResponse.Builder().addDataset(dataset).build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // Phase 2: offer to save new passwords seen in the wild
        callback.onSuccess()
    }
}
```

### 4.2 FieldHintDetector.kt

Walks the `AssistStructure` view tree recursively. For each `ViewNode`:

1. Check `autofillHints` array for known constants (`View.AUTOFILL_HINT_PASSWORD`, etc.)
2. Fall back to `inputType` bitmask (`InputType.TYPE_TEXT_VARIATION_PASSWORD`, `TYPE_NUMBER_VARIATION_PASSWORD`)
3. Fall back to `hint` text keywords ("password", "card", "cvv", "expiry", "upi")
4. Check `htmlInfo.tag` and `htmlInfo.attributes` for `type="password"`, `autocomplete="cc-number"`, etc.

Return a `List<DetectedField>` — each with its `AutofillId`, detected `FieldType`, and the `ViewNode`.

### 4.3 VaultDbReader.kt

The SQLite database is at:
```kotlin
val dbPath = applicationContext.getDatabasePath("SQLite/artha.db")
```

Queries the `vault_entries` table for non-deleted entries:
```sql
SELECT id, title, category, username, email, phone, url, login_method
FROM vault_entries
WHERE deleted_at IS NULL
ORDER BY title ASC
```

**Important:** Only reads unencrypted columns (title, category, etc.) to build the picker list. Encrypted fields (`password_enc`, `pin_enc`, `custom_fields`) are only read after biometric auth succeeds, in `VaultDecryptor`.

### 4.4 VaultDecryptor.kt

The vault encryption key is stored by `expo-secure-store`. On Android, `expo-secure-store` uses `EncryptedSharedPreferences` backed by Android Keystore. The SharedPreferences file is named `SecureStore` (verify at runtime — may change between Expo versions).

```kotlin
// Read the AES key that expo-secure-store wrote
val prefs = EncryptedSharedPreferences.create(
    "SecureStore",
    MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
    context,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
val vaultKey = prefs.getString("vault_aes_key", null)
    ?: throw IllegalStateException("Vault key not found — vault not set up")
```

Then use `javax.crypto.Cipher` with AES-CBC (matching the JS `react-native-aes-crypto` algorithm) to decrypt.

**Risk:** The expo-secure-store key name (`vault_aes_key`) must match what `services/vault.ts` writes. Verify before building.

**Fallback:** If Keystore access fails (device just booted, key invalidated), show error: "Unlock your phone to enable autofill."

### 4.5 ArthAutofillPickerActivity.kt

Native Android activity (not React Native — React Native cannot be started inside an autofill flow reliably on all devices).

Flow:
1. Show BiometricPrompt ("Confirm identity to autofill")
2. On success: query VaultDbReader → show RecyclerView list of vault entries
3. On entry tap: call VaultDecryptor to decrypt the relevant fields
4. Build `Dataset` with actual values
5. Set result: `setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))`
6. `finish()`

The picker UI is plain native Android XML layout (not NativeWind — this activity loads before React Native). Keep it minimal: a RecyclerView with account icon + title + category badge.

### 4.6 withAutofillService.ts (Config Plugin)

```typescript
import { withAndroidManifest } from "@expo/config-plugins";

export const withAutofillService = (config) =>
  withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application[0];

    // Register the AutofillService
    app.service = app.service ?? [];
    app.service.push({
      $: {
        "android:name": ".autofill.ArthAutofillService",
        "android:label": "@string/app_name",
        "android:permission": "android.permission.BIND_AUTOFILL_SERVICE",
      },
      "intent-filter": [{
        action: [{ $: { "android:name": "android.service.autofill.AutofillService" } }],
      }],
      "meta-data": [{
        $: {
          "android:name": "android.autofill",
          "android:resource": "@xml/autofill_service_config",
        },
      }],
    });

    // Register the picker activity
    app.activity = app.activity ?? [];
    app.activity.push({
      $: {
        "android:name": ".autofill.ArthAutofillPickerActivity",
        "android:theme": "@style/Theme.AppCompat.Light.NoActionBar",
        "android:windowSoftInputMode": "adjustResize",
      },
    });

    return config;
  });
```

Add `"./plugins/withAutofillService"` to `app.json` plugins array.

### 4.7 autofill_service_config.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<autofill-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:settingsActivity=".MainActivity">
    <!-- Declares that this service can provide autofill suggestions -->
</autofill-service>
```

---

## 5. Per-App Memory (vault-autofill-prefs.ts)

After a user fills a field from a specific vault entry, remember the mapping for next time:

```typescript
// MMKV key: "autofill_pref:{packageName}:{fieldType}"
// Value: vault entry ID
function rememberChoice(packageName: string, fieldType: string, entryId: string): void {
  storage.set(`autofill_pref:${packageName}:${fieldType}`, entryId);
}

function getPreferredEntry(packageName: string, fieldType: string): string | null {
  return storage.getString(`autofill_pref:${packageName}:${fieldType}`) ?? null;
}
```

The `ArthAutofillPickerActivity` writes this via a broadcast intent that the React Native layer receives and persists to MMKV. Alternatively: write to a shared SharedPreferences file that both native and JS can read.

---

## 6. User Setup Flow

The user needs to manually set Arth as the autofill provider once. Add an onboarding prompt:

**Settings → Security → Autofill** (new entry):

```
Autofill with Arth
Use your Arth Vault to fill passwords and 
card details in other apps.

[ Set up Autofill ]     → Opens Android Settings → Autofill service → Arth
```

Detection: `AutofillManager.isAutofillSupported()` + `AutofillManager.hasEnabledAutofillServices()`.

---

## 7. Implementation Phases

### Phase 1 — Infrastructure (2 weeks)
- [ ] `FieldHintDetector.kt` — detect all standard autofill hints
- [ ] `ArthAutofillService.kt` — skeleton, always returns "Tap to fill with Arth"
- [ ] `ArthAutofillPickerActivity.kt` — native UI, no biometric yet (dev testing only)
- [ ] `VaultDbReader.kt` — read vault entry list from SQLite
- [ ] `withAutofillService.ts` config plugin + resource files
- [ ] Wire into `app.json` plugins
- [ ] Settings entry to open Android autofill settings
- [ ] Manual test: Chrome password field, banking app card number field

### Phase 2 — Biometric gate (1 week)
- [ ] `BiometricPrompt` integration in `ArthAutofillPickerActivity`
- [ ] `VaultDecryptor.kt` — AES-CBC decryption using Keystore key
- [ ] Test key name from `expo-secure-store` (check actual MMKV/SharedPreferences key at runtime)
- [ ] Error handling: key not found, biometric not enrolled, device not secure
- [ ] Auth-gated fill for: password, card number, CVV, PIN, UPI PIN
- [ ] Inline (no-auth) fill for: username, email, phone (non-sensitive)

### Phase 3 — Smart matching (1 week)
- [ ] `vault-autofill-prefs.ts` — MMKV per-app preference
- [ ] Picker pre-selects the preferred entry for a known package name
- [ ] Show "Remember for this app" toggle in picker
- [ ] Package name → bank mapping: if the calling app is `com.hdfcbank.MobileBanking`, pre-filter to HDFC cards
- [ ] Settings page: "Autofill preferences" — shows per-app mappings, lets user clear them
- [ ] Save-password offer: when user manually types into a password field in an app that has no Arth entry, offer "Save to Arth Vault?"

---

## 8. Database & Schema Changes

None. This feature reads the existing `vault_entries` table — no new columns or migrations needed.

MMKV keys added (per-app autofill preferences) — no schema changes.

---

## 9. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `expo-secure-store` key name changes between Expo versions | Read the key name at runtime from a known SharedPreferences entry written by the JS side during vault setup |
| `VaultDecryptor` uses different AES mode than JS side | JS uses AES-CBC (react-native-aes-crypto). Verify IV handling — JS may prepend IV to ciphertext. Unit test decryption before Phase 2 ships. |
| `ArthAutofillPickerActivity` starts before React Native bridge is ready | Activity must be fully native (no `ReactActivity`, no JS). No NativeWind, no Expo components. |
| Autofill not available on Android < 8.0 | Check `Build.VERSION.SDK_INT >= Build.VERSION_CODES.O` and hide the feature gracefully on older devices (Arth's min SDK should already be 26+). |
| Samsung/Xiaomi/Oppo ROM autofill quirks | These OEMs sometimes intercept autofill or show their own overlay. Test on 2–3 device families. |
| react-native-aes-crypto key storage format | The key may be stored as hex, base64, or raw bytes. Confirm format by logging the stored value during development. |

---

## 10. Testing Plan

- [ ] Unit test `FieldHintDetector` with mock `AssistStructure` objects
- [ ] Unit test `VaultDecryptor` against a known ciphertext from the JS vault service
- [ ] Integration: tap "Fill with Arth" in Chrome → biometric → pick entry → field fills
- [ ] Integration: HDFC mobile banking app → card number field autofill
- [ ] Integration: UPI app → UPI PIN field (if app exposes autofill hint)
- [ ] Edge case: vault is locked (biometric not yet authenticated after boot) → graceful error
- [ ] Edge case: no vault entries matching the field type → picker shows empty state
- [ ] Edge case: user cancels biometric → no fill, no crash

---

## 11. What NOT to Do

1. **Don't try to start React Native** inside `ArthAutofillPickerActivity`. React Native's bridge startup is too slow and unreliable in this context.
2. **Don't store decrypted vault fields in any persistent store** (SharedPreferences, file, cache). Decrypt → fill → discard.
3. **Don't cache the AES key** across process restarts. Re-read from Keystore each time to respect the Android lock-screen security guarantee.
4. **Don't assume the autofill hint is always correct.** Some apps (especially older ones) don't declare hints. Always fall back to `inputType` + hint text scanning.
5. **Don't try to fill OTP fields** — those are handled by Android's SMS Retriever API, not autofill.

---

## 12. Reference

- Android AutofillService docs: https://developer.android.com/reference/android/service/autofill/AutofillService
- Bitwarden Android open source (reference implementation): https://github.com/bitwarden/android
- expo-secure-store source (key storage format): https://github.com/expo/expo/tree/main/packages/expo-secure-store/android
- react-native-aes-crypto (AES-CBC format): https://github.com/tectiv3/react-native-aes-crypto
