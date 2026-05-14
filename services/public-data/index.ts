import { getDatabase } from "@/database";
import { logger } from "@/utils/logger";
import {
    loadIfscBundle,
    loadMccBundle,
    loadMerchantBrandBundle,
    loadSmsSenderBundle,
    loadSmsTemplateBundle,
    type DataBundleEnvelope,
    type IfscPrefixEntry,
    type MccCodeEntry,
    type MerchantBrandEntry,
    type SmsSenderEntry,
    type SmsTemplateEntry,
} from "./bundle-loader";

const BUNDLE_NAMES = {
  ifsc: "ifsc-prefixes",
  senders: "sms-senders",
  templates: "sms-templates",
  mcc: "mcc-codes",
  brands: "merchant-brands",
} as const;

/**
 * Idempotent public-data seeder. Reads bundled JSON assets (if present) and
 * upserts rows with INSERT OR IGNORE so user/learned rows are never stomped.
 * Records the seeded version in data_bundle_versions; subsequent runs with
 * the same bundle version are no-ops.
 *
 * In Phase 1 no bundles are shipped, so this is a clean no-op that just
 * records empty versions. In Phase 2, actual JSON under assets/data/ will
 * flow through these same code paths.
 */
export async function seedPublicData(): Promise<void> {
  await Promise.all([
    seedBundleBulk(
      BUNDLE_NAMES.ifsc,
      loadIfscBundle(),
      (entries, version) => {
        const placeholders = entries.map(() => "(?,?,?,?)").join(",");
        const params: (string | null)[] = entries.flatMap((e) => [
          (e as IfscPrefixEntry).ifsc_prefix,
          (e as IfscPrefixEntry).bank_name,
          (e as IfscPrefixEntry).bank_short_code ?? null,
          version,
        ]);
        return [`INSERT OR IGNORE INTO ifsc_bank_registry (ifsc_prefix, bank_name, bank_short_code, source_version) VALUES ${placeholders};`, params];
      },
    ),
    seedBundleBulk(
      BUNDLE_NAMES.senders,
      loadSmsSenderBundle(),
      (entries, version) => {
        const placeholders = entries.map(() => "(?,?,?,?,?)").join(",");
        const params: (string | number | null)[] = entries.flatMap((e) => [
          (e as SmsSenderEntry).sender_code,
          (e as SmsSenderEntry).bank_name,
          (e as SmsSenderEntry).bank_type ?? null,
          (e as SmsSenderEntry).confidence ?? 0.9,
          version,
        ]);
        return [`INSERT OR IGNORE INTO sms_sender_registry (sender_code, bank_name, bank_type, confidence, source_version) VALUES ${placeholders};`, params];
      },
    ),
    seedBundleBulk(
      BUNDLE_NAMES.templates,
      loadSmsTemplateBundle(),
      (entries, version) => {
        const placeholders = entries.map(() => "(?,?,?,?,?,?,?)").join(",");
        const params: (string | number | null)[] = entries.flatMap((e) => [
          (e as SmsTemplateEntry).id,
          (e as SmsTemplateEntry).bank_name,
          (e as SmsTemplateEntry).template_id ?? null,
          (e as SmsTemplateEntry).pattern_regex,
          (e as SmsTemplateEntry).tx_type,
          (e as SmsTemplateEntry).priority ?? 100,
          version,
        ]);
        return [`INSERT OR IGNORE INTO sms_template_patterns (id, bank_name, template_id, pattern_regex, tx_type, priority, source_version) VALUES ${placeholders};`, params];
      },
    ),
    seedBundleBulk(
      BUNDLE_NAMES.mcc,
      loadMccBundle(),
      (entries, version) => {
        const placeholders = entries.map(() => "(?,?,?,?)").join(",");
        const params: (string | null)[] = entries.flatMap((e) => [
          (e as MccCodeEntry).code,
          (e as MccCodeEntry).description,
          (e as MccCodeEntry).category_name ?? null,
          version,
        ]);
        return [`INSERT OR IGNORE INTO mcc_codes (code, description, category_name, source_version) VALUES ${placeholders};`, params];
      },
    ),
    seedBundleBulk(
      BUNDLE_NAMES.brands,
      loadMerchantBrandBundle(),
      (entries, version) => {
        const placeholders = entries.map(() => "(?,?,?,?,?,?)").join(",");
        const params: (string | null)[] = entries.flatMap((e) => [
          (e as MerchantBrandEntry).id,
          (e as MerchantBrandEntry).brand_canonical,
          (e as MerchantBrandEntry).alias,
          (e as MerchantBrandEntry).category_name ?? null,
          (e as MerchantBrandEntry).mcc_code ?? null,
          version,
        ]);
        return [`INSERT OR IGNORE INTO merchant_brand_registry (id, brand_canonical, alias, category_name, mcc_code, source_version) VALUES ${placeholders};`, params];
      },
    ),
  ]);
}

type BundleEntry = IfscPrefixEntry | SmsSenderEntry | SmsTemplateEntry | MccCodeEntry | MerchantBrandEntry;

async function seedBundleBulk<T extends BundleEntry>(
  bundleName: string,
  envelope: DataBundleEnvelope<T> | null,
  buildBulkInsert: (entries: T[], version: string) => [string, (string | number | null)[]],
): Promise<void> {
  const db = getDatabase();

  if (!envelope || envelope.entries.length === 0) {
    return;
  }

  const alreadySeeded = await db.getFirstAsync<{ seeded_version: string }>(
    "SELECT seeded_version FROM data_bundle_versions WHERE bundle_name = ?;",
    bundleName,
  );

  if (alreadySeeded?.seeded_version === envelope.version) {
    return;
  }

  try {
    const [sql, params] = buildBulkInsert(envelope.entries, envelope.version);
    await db.withTransactionAsync(async () => {
      await db.runAsync(sql, params);
      await db.runAsync(
        `INSERT INTO data_bundle_versions (bundle_name, seeded_version, seeded_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(bundle_name) DO UPDATE SET
           seeded_version = excluded.seeded_version,
           seeded_at = excluded.seeded_at;`,
        bundleName,
        envelope.version,
      );
    });
  } catch (e) {
    logger.warn(`Public-data seed for ${bundleName} failed (non-fatal):`, e);
  }
}
