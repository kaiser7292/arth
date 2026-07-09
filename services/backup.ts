import { getDatabase } from "@/database";
import { TABLE_SCHEMAS } from "@/database/TABLE_SCHEMAS";
import { bumpDataVersion, setLastBackupAt } from "@/services/settings";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import Aes from "react-native-aes-crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupMetadata {
  version: number;
  appVersion: string;
  createdAt: string;
  tables: string[];
  rowCounts: Record<string, number>;
}

export interface BackupResult {
  success: boolean;
  filePath: string | null;
  metadata: BackupMetadata | null;
  error: string | null;
}

export interface RestoreResult {
  success: boolean;
  tablesRestored: string[];
  totalRows: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 2; // v2 = integer paise storage (migration 060)
export const MIN_PASSWORD_LENGTH = 8;
// Read version dynamically from app.json
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../app.json").expo.version;
const MAGIC_HEADER = "ARTHA_BKP"; // 9 bytes — must stay exactly 9
if (MAGIC_HEADER.length !== 9) {
  throw new Error(`MAGIC_HEADER must be exactly 9 bytes, got ${MAGIC_HEADER.length}`);
}
const SALT_LENGTH = 32; // 32 bytes
const IV_LENGTH = 16; // 16 bytes for AES
const KEY_ITERATIONS = 600000; // PBKDF2 iterations (OWASP 2023 recommendation)
const LEGACY_V2_KEY_ITERATIONS = 100000; // For restoring V2 backups created before v5.1

/** Strip path traversal characters from a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/\.{2,}/g, "").replace(/[/\\\0]/g, "");
}

// Tables to include in backup (order matters for restore — parents before children)
export const BACKUP_TABLES = [
  // Independent tables (no FK dependencies)
  "users",
  "merchant_mappings",
  // Level 1: depend on users only
  "categories",
  "payment_modes",
  "tags",
  "yearly_plans",
  "life_milestones",
  "hisaab_persons",
  "merchant_aliases",
  "unavoidable_baselines",
  "merchant_corrections",
  "financial_accounts",
  "salary_profiles",
  // Level 2: depend on level 1
  "budgets",
  "pending_sms",
  "recurring_transactions",
  "expense_classifications",
  "expenses",
  "investment_buckets",
  "milestone_contributions",
  "hisaab_entries",
  "account_payment_modes",
  "account_month_balances",
  "account_credits",
  // investment_contributions moved here (was Level 3) so it precedes
  // account_transfers — account_transfers.linked_contribution_id FKs into
  // this table. v15.9.3 fix: pre-v15.9.3, restore put this after transfers,
  // causing every demat-linked transfer to silently fail the FK check and
  // get dropped. Defense in depth alongside the PRAGMA foreign_keys=OFF
  // wrapping in the restore transaction.
  "investment_contributions",
  "account_transfers",
  "demat_portfolio_snapshots",
  "demat_fund_snapshots",
  "expense_splits",
  // Level 3: depend on level 2
  "budget_breakdowns",
  "expense_tags",
  "recurring_expense_rules", // depends on expenses (source_expense_id FK)
  "reminder_fulfillments", // depends on recurring_expense_rules + expenses
  // v15 Phase 1 — public reference data (all independent, additive)
  "ifsc_bank_registry",
  "sms_sender_registry",
  "sms_template_patterns",
  "mcc_codes",
  "merchant_brand_registry",
  "data_bundle_versions",
  "reminder_suggestions",
  // v15.2 — user-authored smart rules (independent table, no FK refs)
  "smart_rules",
  // v16.0.0 — cash-flow simulator. scenarios first (parent), entries after
  // (child FK scenario_id → scenarios.id ON DELETE CASCADE).
  "simulation_scenarios",
  "simulation_entries",
  // v16.0.5 — per-scenario hisaab inclusions (FK to scenarios).
  "simulation_hisaab_inclusions",
  // v1.1.0 — multi-link fulfillments (entry → many expenses). FK to simulation_entries.
  "simulation_entry_fulfillments",
  // v17.0.0 — expense→investment-bucket links. Depends on expenses + investment_buckets
  // (both listed earlier). ON DELETE CASCADE means orphans can't survive anyway.
  "expense_investment_links",
  // v17.0.0 — loan management. loan_accounts depends on financial_accounts; the
  // schedule+prepayments depend on loan_accounts. Keep this order.
  "loan_accounts",
  "loan_schedule_entries",
  "loan_prepayments",
  // v17.4.0 — expense→loan payment links. Depends on expenses + loan_accounts
  // + loan_schedule_entries + loan_prepayments (all listed earlier).
  "expense_loan_links",
  // v17.5.1 — manual loan corrections. Depends on loan_accounts.
  "loan_corrections",
  // v17.5.38 — field-level edit history. Depends on expenses.
  "expense_edit_history",
  // v17.6.x — SMS scan run logging. sms_scan_details depends on sms_scan_runs.
  "sms_scan_runs",
  "sms_scan_details",
  // v18.x — password vault. Independent table, no FK dependencies.
  "vault_entries",
  // v18.x — reconciliation. Sessions before items (FK: items.session_id → sessions.id).
  "reconciliation_sessions",
  "reconciliation_items",
];

// ---------------------------------------------------------------------------
// Key derivation (PBKDF2 via react-native-aes-crypto)
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit key from a password using PBKDF2 with HMAC-SHA256.
 * Uses react-native-aes-crypto's native PBKDF2 implementation.
 */
async function deriveKey(
  password: string,
  saltHex: string,
  iterations = KEY_ITERATIONS,
): Promise<string> {
  // Returns hex-encoded 256-bit key
  return Aes.pbkdf2(password, saltHex, iterations, 256, "sha256");
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption (via react-native-aes-crypto)
// ---------------------------------------------------------------------------

/**
 * Encrypt data using AES-256-GCM.
 * Returns base64-encoded ciphertext. GCM provides both confidentiality and integrity.
 */
// The native module supports GCM at runtime, but the shipped .d.ts omits it
// from the Algorithms union. Cast at the boundary so the rest of the codebase
// stays strictly typed. Tracking: upstream react-native-aes-crypto@3.x typings drift.
const AES_256_GCM = "aes-256-gcm" as unknown as Parameters<typeof Aes.encrypt>[3];

async function encryptData(
  plaintext: string,
  keyHex: string,
  ivHex: string,
): Promise<string> {
  return Aes.encrypt(plaintext, keyHex, ivHex, AES_256_GCM);
}

/**
 * Decrypt data using AES-256-GCM.
 */
async function decryptData(
  ciphertext: string,
  keyHex: string,
  ivHex: string,
): Promise<string> {
  return Aes.decrypt(ciphertext, keyHex, ivHex, AES_256_GCM);
}

// ---------------------------------------------------------------------------
// Legacy V1 key derivation + XOR encryption (for backward-compatible restore)
// ---------------------------------------------------------------------------

/**
 * Legacy key derivation: iterated SHA-256 (V1 backup format).
 * @deprecated Only used for restoring V1 backups.
 */
async function legacyDeriveKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  let data = password + arrayToHex(salt);
  for (let i = 0; i < LEGACY_V2_KEY_ITERATIONS; i++) {
    data = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      data,
    );
  }
  return hexToArray(data.slice(0, 64));
}

/**
 * Legacy XOR-based decryption (V1 backup format).
 * @deprecated Only used for restoring V1 backups.
 */
async function legacyDecryptData(
  encrypted: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const decrypted = new Uint8Array(encrypted.length);
  const blockSize = 32;
  let keystreamOffset = 0;
  let blockIndex = 0;

  while (keystreamOffset < encrypted.length) {
    const blockInput =
      arrayToHex(key) + arrayToHex(iv) + blockIndex.toString(16).padStart(8, "0");
    const blockHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      blockInput,
    );
    const keystreamBlock = hexToArray(blockHash);

    for (
      let j = 0;
      j < blockSize && keystreamOffset < encrypted.length;
      j++, keystreamOffset++
    ) {
      decrypted[keystreamOffset] =
        encrypted[keystreamOffset] ^ keystreamBlock[j];
    }

    blockIndex++;
  }

  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// Backup creation
// ---------------------------------------------------------------------------

/**
 * Create a full encrypted backup of all app data.
 * Returns the file path of the created backup.
 */
export async function createBackup(password: string): Promise<BackupResult> {
  // Enforce minimum password length on creation
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      success: false,
      filePath: null,
      metadata: null,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  try {
    const db = getDatabase();

    // 1. Export all tables to JSON
    const tableData: Record<string, unknown[]> = {};
    const rowCounts: Record<string, number> = {};

    for (const table of BACKUP_TABLES) {
      try {
        const rows = await db.getAllAsync(`SELECT * FROM ${table};`);
        tableData[table] = rows;
        rowCounts[table] = rows.length;
      } catch {
        // Table might not exist yet — skip it
        tableData[table] = [];
        rowCounts[table] = 0;
      }
    }

    // 2. Build backup payload
    const metadata: BackupMetadata = {
      version: BACKUP_VERSION,
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      tables: BACKUP_TABLES,
      rowCounts,
    };

    const payload = JSON.stringify({ metadata, data: tableData });

    // 3. Generate salt and IV (as hex strings)
    const saltHex = arrayToHex(Crypto.getRandomBytes(SALT_LENGTH));
    const ivHex = arrayToHex(Crypto.getRandomBytes(IV_LENGTH));

    // 4. Derive key from password using PBKDF2
    const keyHex = await deriveKey(password, saltHex);

    // 5. Encrypt the payload with AES-256-GCM
    const encryptedBase64 = await encryptData(payload, keyHex, ivHex);

    // 6. Build the backup file: MAGIC + salt + iv + encrypted data
    //    Salt and IV stored as hex (fixed length), encrypted as base64
    const header = new TextEncoder().encode(MAGIC_HEADER);
    const saltBytes = hexToArray(saltHex);
    const ivBytes = hexToArray(ivHex);
    const encryptedBytes = base64ToArray(encryptedBase64);

    const fileData = new Uint8Array(
      header.length + SALT_LENGTH + IV_LENGTH + encryptedBytes.length,
    );
    fileData.set(header, 0);
    fileData.set(saltBytes, header.length);
    fileData.set(ivBytes, header.length + SALT_LENGTH);
    fileData.set(encryptedBytes, header.length + SALT_LENGTH + IV_LENGTH);

    // 7. Write to file
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName = `arth-backup-${sanitizeFilename(timestamp)}.arth`;
    const backupFile = new File(Paths.cache, fileName);
    await backupFile.write(arrayToBase64(fileData));

    setLastBackupAt(metadata.createdAt);

    return {
      success: true,
      filePath: backupFile.uri,
      metadata,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      filePath: null,
      metadata: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Share a backup file so the user can save it wherever they want.
 */
export async function shareBackup(filePath: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: "application/octet-stream",
      dialogTitle: "Save Artha Backup",
    });
  }
  // Clean up the temporary backup file from cache after sharing
  try {
    const tempFile = new File(filePath);
    if (tempFile.exists) {
      tempFile.delete();
    }
  } catch {
    // Non-critical — file will be cleaned up by OS cache management
  }
}

/** SAF URI that seeds the picker inside the Downloads folder on Android. */
const ANDROID_DOWNLOADS_INITIAL_URI =
  "content://com.android.externalstorage.documents/document/primary:Download";

/**
 * Result of saveBackupToStorage.
 * - `cancelled`: user dismissed the folder picker without choosing anything.
 * - `unsupported`: SAF only exists on Android; iOS users should use shareBackup instead.
 */
export interface SaveBackupToStorageResult {
  ok: boolean;
  destUri?: string;
  error?: string;
  cancelled?: boolean;
  unsupported?: boolean;
}

/**
 * Save a backup file to a user-picked folder via the Android Storage Access
 * Framework (SAF). Pre-seeds the picker to the Downloads folder — user can
 * still navigate anywhere. Writes the same base64-text content the file
 * already has in cache so the restore path reads it unchanged.
 *
 * Android-only. iOS falls back to shareBackup.
 */
export async function saveBackupToStorage(
  filePath: string,
): Promise<SaveBackupToStorageResult> {
  // v16.0.8 — delegates to the shared `saveToPhone` helper so backup and
  // hisaab exports use the same code path. Backup files are stored as
  // base64-text (see createBackup) and restore reads them as text; reading
  // + writing as utf8 round-trips safely.
  const { saveToPhone } = await import("./save-to-phone");
  return saveToPhone({
    sourcePath: filePath,
    encoding: "utf8",
    mimeType: "application/octet-stream",
    fileName: filePath.split("/").pop() ?? "arth-backup.arth",
    deleteSourceOnSuccess: true,
  });
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Max file size for backup restore: 50 MB. */
const MAX_BACKUP_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Pick a backup file from the device.
 * Validates file extension (.arth / .artha / .json) and size (max 50 MB).
 */
export interface PickedBackupFile {
  uri: string;
  name: string;
  sizeLabel: string;
  /** True when the file is a plain-JSON scheduled backup (no encryption, no password needed). */
  isAutoBackup?: boolean;
}

/**
 * Pick a backup file, validate extension + content.
 * Accepts .arth/.artha (encrypted manual backup) and .json (plain auto-backup).
 * Returns file info or null if cancelled. Throws on validation failure.
 */
export async function pickAndValidateBackupFile(): Promise<PickedBackupFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];

  // Validate extension
  const ext = asset.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (ext !== ".arth" && ext !== ".artha" && ext !== ".json") {
    throw new Error(`Unsupported file type "${ext}". Select a .arth or .json Arth backup file.`);
  }

  // Validate file size
  if (asset.size && asset.size > MAX_BACKUP_FILE_SIZE) {
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File is too large (${sizeMB} MB). Maximum allowed size is 50 MB.`);
  }

  const sizeKB = asset.size ? (asset.size / 1024).toFixed(0) : "?";
  const sizeLabel = asset.size && asset.size >= 1024 * 1024
    ? `${(asset.size / (1024 * 1024)).toFixed(1)} MB`
    : `${sizeKB} KB`;

  // .json — plain auto-backup format: validate it has the expected structure.
  if (ext === ".json") {
    try {
      const file = new File(asset.uri);
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { data?: Record<string, unknown[]> };
      if (!parsed?.data) throw new Error("missing data field");
    } catch {
      throw new Error("This JSON file is not a valid Arth auto-backup.");
    }
    return { uri: asset.uri, name: asset.name, sizeLabel, isAutoBackup: true };
  }

  // .arth / .artha — encrypted backup: validate magic header.
  const file = new File(asset.uri);
  const base64Content = await file.text();
  const fileData = base64ToArray(base64Content);

  if (fileData.length < MAGIC_HEADER.length + SALT_LENGTH + IV_LENGTH + 1) {
    throw new Error("File is too small to be a valid Arth backup.");
  }

  const headerBytes = fileData.slice(0, MAGIC_HEADER.length);
  const header = new TextDecoder().decode(headerBytes);
  if (header !== MAGIC_HEADER) {
    throw new Error("This file is not a valid Arth backup. It may be corrupted or not created by Arth.");
  }

  return { uri: asset.uri, name: asset.name, sizeLabel };
}

/**
 * Restore tables from a parsed data dictionary (the inner JSON from any backup).
 * Shared by both the encrypted backup restore and auto-backup restore paths.
 */
export async function restoreFromData(
  data: Record<string, unknown[]>,
): Promise<RestoreResult> {
  const db = getDatabase();
  const tablesRestored: string[] = [];
  let totalRows = 0;

  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      for (const table of [...BACKUP_TABLES].reverse()) {
        try { await db.runAsync(`DELETE FROM ${table};`); } catch { /* table may not exist */ }
      }

      const BATCH_SIZE = 50;
      for (const table of BACKUP_TABLES) {
        const rows = data[table];
        if (!rows || rows.length === 0) continue;

        const allowedColumns = TABLE_SCHEMAS[table];
        if (!allowedColumns) continue;
        const allowedSet = new Set(allowedColumns);
        const firstRecord = rows[0] as Record<string, unknown>;
        const columns = Object.keys(firstRecord).filter((col) => allowedSet.has(col));
        if (columns.length === 0) continue;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const valueSets: string[] = [];
          const allValues: (string | number | null)[] = [];

          for (const row of batch) {
            const record = row as Record<string, unknown>;
            valueSets.push(`(${columns.map(() => "?").join(", ")})`);
            for (const col of columns) {
              const val = record[col];
              if (val === null || val === undefined) allValues.push(null);
              else if (typeof val === "string" || typeof val === "number") allValues.push(val);
              else allValues.push(String(val));
            }
          }

          try {
            await db.runAsync(
              `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES ${valueSets.join(", ")};`,
              ...allValues,
            );
          } catch {
            for (const row of batch) {
              const record = row as Record<string, unknown>;
              const vals = columns.map((col) => {
                const val = record[col];
                if (val === null || val === undefined) return null;
                if (typeof val === "string" || typeof val === "number") return val;
                return String(val);
              });
              try {
                await db.runAsync(
                  `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")});`,
                  ...vals,
                );
              } catch { /* skip rows that fail */ }
            }
          }
        }
        tablesRestored.push(table);
        totalRows += rows.length;
      }

      // Post-restore: migration-005 semantics for legacy account_credits
      try {
        await db.execAsync(`
          INSERT OR IGNORE INTO expenses (
            id, user_id, amount, currency, description,
            date, source, status, nature,
            account_id, deleted_at, created_at, updated_at,
            transaction_time
          )
          SELECT
            id, user_id, amount, 'INR', description,
            date,
            CASE WHEN source = 'sms_auto' THEN 'sms_auto' ELSE 'manual' END,
            'approved', 'credit',
            account_id, deleted_at, created_at, updated_at,
            '00:00:00'
          FROM account_credits;
        `);
        await db.execAsync(`
          UPDATE expenses SET nature = 'credit', updated_at = datetime('now')
          WHERE refund_of_expense_id IS NOT NULL AND nature = 'realized';
        `);
        await db.execAsync(`
          UPDATE hisaab_entries
          SET linked_expense_id = linked_account_credit_id, updated_at = datetime('now')
          WHERE linked_account_credit_id IS NOT NULL AND linked_expense_id IS NULL;
        `);
      } catch { /* account_credits may not exist */ }

      // Post-restore: repair hisaab↔expense links via expense_splits bridge
      try {
        await db.execAsync(`
          UPDATE hisaab_entries
          SET linked_expense_id = (
            SELECT es.expense_id FROM expense_splits es
            WHERE es.hisaab_entry_id = hisaab_entries.id LIMIT 1
          ), updated_at = datetime('now')
          WHERE linked_expense_id IS NULL
            AND id IN (SELECT hisaab_entry_id FROM expense_splits WHERE hisaab_entry_id IS NOT NULL);
        `);
      } catch { /* expense_splits may not exist */ }
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }

  await bumpDataVersion();
  return { success: true, tablesRestored, totalRows, error: null };
}

/**
 * Restore from an encrypted backup file.
 */
export async function restoreBackup(
  fileUri: string,
  password: string,
): Promise<RestoreResult> {
  try {
    const db = getDatabase();

    // 1. Read the file (written as base64 text, so read as text)
    const file = new File(fileUri);
    const base64Content = await file.text();
    const fileData = base64ToArray(base64Content);

    // 2. Validate magic header
    const headerBytes = fileData.slice(0, MAGIC_HEADER.length);
    const header = new TextDecoder().decode(headerBytes);
    if (header !== MAGIC_HEADER) {
      return {
        success: false,
        tablesRestored: [],
        totalRows: 0,
        error: "Invalid backup file. This doesn't appear to be an Artha backup.",
      };
    }

    // 3. Extract salt, IV, and encrypted data
    const offset = MAGIC_HEADER.length;
    const salt = fileData.slice(offset, offset + SALT_LENGTH);
    const iv = fileData.slice(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH);
    const encrypted = fileData.slice(offset + SALT_LENGTH + IV_LENGTH);

    // 4. Derive key and decrypt
    //    Try AES-256-GCM (600k iterations) first, then AES-256-GCM (100k — pre-v5.1),
    //    then legacy XOR (V1 format)
    let payload: string;
    const saltHex = arrayToHex(salt);
    const ivHex = arrayToHex(iv);
    const encryptedBase64 = arrayToBase64(encrypted);
    try {
      const keyHex = await deriveKey(password, saltHex);
      payload = await decryptData(encryptedBase64, keyHex, ivHex);
    } catch {
      // Fall back to V2 legacy (100k iterations) for backups created before v5.1
      try {
        const keyHex = await deriveKey(password, saltHex, LEGACY_V2_KEY_ITERATIONS);
        payload = await decryptData(encryptedBase64, keyHex, ivHex);
      } catch {
        // Fall back to legacy V1 XOR decryption for backward compatibility
        try {
          const legacyKey = await legacyDeriveKey(password, salt);
          payload = await legacyDecryptData(encrypted, legacyKey, iv);
        } catch {
          return {
            success: false,
            tablesRestored: [],
            totalRows: 0,
            error: "Decryption failed. Wrong password or corrupted file.",
          };
        }
      }
    }

    // 5. Parse JSON
    let parsed: { metadata: BackupMetadata; data: Record<string, unknown[]> };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return {
        success: false,
        tablesRestored: [],
        totalRows: 0,
        error: "Wrong password or corrupted backup.",
      };
    }

    // 6. Validate backup version
    if (!parsed.metadata || !parsed.data) {
      return {
        success: false,
        tablesRestored: [],
        totalRows: 0,
        error: "Invalid backup format.",
      };
    }

    // 7. Convert rupee amounts to paise if restoring an old v1 backup
    if ((parsed.metadata.version ?? 1) < 2) {
      convertLegacyRupeesToPaise(parsed.data);
    }

    // 8. Restore tables via shared restoreFromData helper
    return await restoreFromData(parsed.data);
  } catch (e) {
    try { await getDatabase().execAsync("PRAGMA foreign_keys = ON;"); } catch { /* ignore */ }
    return {
      success: false,
      tablesRestored: [],
      totalRows: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Amount columns per table that need ×100 conversion when restoring a v1
 * backup (rupees) into a v2+ database (paise). Non-monetary columns
 * (percentages, counts, IDs) are intentionally excluded.
 */
const PAISE_COLUMNS: Partial<Record<string, string[]>> = {
  expenses: ["amount", "split_original_amount", "split_exact_amount", "convenience_fee", "fee_absorbed"],
  account_month_balances: ["opening_balance"],
  account_transfers: ["amount"],
  account_credits: ["amount"],
  budgets: ["amount"],
  budget_breakdowns: ["amount"],
  yearly_plans: ["annual_salary_in_hand", "expected_bonus", "total_planned_expenses", "total_planned_investments", "total_planned_milestones"],
  investment_buckets: ["annual_target", "current_contributed"],
  investment_contributions: ["amount"],
  life_milestones: ["target_amount", "current_saved", "monthly_contribution_planned"],
  milestone_contributions: ["amount"],
  financial_accounts: ["credit_limit", "last_known_balance", "total_due", "min_due", "nach_amount", "fund_balance", "min_balance"],
  hisaab_persons: ["initial_balance"],
  hisaab_entries: ["amount"],
  expense_splits: ["amount"],
  loan_accounts: ["principal_sanctioned", "principal_disbursed", "emi_amount", "processing_fee", "stamp_duty", "insurance_premium", "foreclosure_waiver_min_amount", "last_sms_reminder_amount"],
  loan_schedule_entries: ["opening_principal", "emi_amount", "principal_component", "interest_component", "closing_principal", "paid_amount"],
  loan_prepayments: ["amount", "prepayment_charge", "gst_on_charge"],
  loan_corrections: ["outstanding_principal", "emi_amount"],
  simulation_entries: ["amount"],
  simulation_hisaab_inclusions: ["amount"],
  demat_portfolio_snapshots: ["portfolio_value"],
  demat_fund_snapshots: ["fund_value"],
  sms_scan_details: ["parsed_amount"],
  recurring_transactions: ["amount"],
  expense_classifications: ["amount_range_low", "amount_range_high"],
  expense_loan_links: ["amount"],
  expense_investment_links: ["contribution_amount"],
  unavoidable_baselines: ["monthly_amount"],
  reconciliation_sessions: ["stmt_closing_bal", "arth_closing_bal"],
  reconciliation_items: ["stmt_amount"],
  recurring_expense_rules: ["amount"],
  salary_profiles: [
    "annual_ctc", "vpf_monthly", "professional_tax_annual",
    "deductions_80c", "deductions_80d", "hra_exemption_annual",
    "home_loan_interest", "other_deductions", "expected_capital_gains",
    "expected_bonus", "capital_gains_equity_ltcg", "capital_gains_equity_stcg",
    "capital_gains_debt", "capital_gains_fd", "capital_gains_gold",
    "capital_gains_real_estate", "computed_monthly_in_hand", "computed_annual_tax",
    "manual_monthly_in_hand", "manual_basic", "manual_hra", "manual_special",
    "manual_employer_epf", "manual_gratuity",
  ],
  smart_rules: ["match_min_amount", "match_max_amount"],
};

/**
 * Convert a v1 backup's amounts (rupees) to integer paise in-place so it
 * can be safely restored into a v2+ database. Also patches smart_rules
 * amount conditions stored in the `conditions` JSON column.
 */
export function convertLegacyRupeesToPaise(data: Record<string, unknown[]>): void {
  for (const [table, amountCols] of Object.entries(PAISE_COLUMNS)) {
    const rows = data[table] as Array<Record<string, unknown>> | undefined;
    if (!rows) continue;
    for (const row of rows) {
      for (const col of amountCols!) {
        if (col in row && row[col] != null && typeof row[col] === "number") {
          row[col] = Math.round((row[col] as number) * 100);
        }
      }
      // Smart rules: patch amount conditions in the `conditions` JSON column
      if (table === "smart_rules" && typeof row.conditions === "string") {
        try {
          const conds = JSON.parse(row.conditions) as Array<{ field: string; operator: string; value: unknown }>;
          let changed = false;
          const updated = conds.map((c) => {
            if (c.field !== "amount") return c;
            if (Array.isArray(c.value)) {
              changed = true;
              return { ...c, value: (c.value as number[]).map((v) => Math.round(v * 100)) };
            }
            if (typeof c.value === "number") {
              changed = true;
              return { ...c, value: Math.round(c.value * 100) };
            }
            return c;
          });
          if (changed) row.conditions = JSON.stringify(updated);
        } catch { /* malformed JSON, skip */ }
      }
      // Salary profiles: patch monthly_overrides JSON {month: amount_rupees}
      if (table === "salary_profiles" && typeof row.monthly_overrides === "string") {
        try {
          const overrides = JSON.parse(row.monthly_overrides) as Record<string, number>;
          const patched: Record<string, number> = {};
          for (const [month, val] of Object.entries(overrides)) {
            patched[month] = typeof val === "number" ? Math.round(val * 100) : val;
          }
          row.monthly_overrides = JSON.stringify(patched);
        } catch { /* malformed JSON, skip */ }
      }
    }
  }
}

function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function arrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
