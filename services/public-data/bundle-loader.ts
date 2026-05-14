/**
 * Loads bundled JSON public-data assets via Metro's static require. Each
 * loader returns null if the bundle hasn't shipped yet so Phase 1 can boot
 * with nothing committed under assets/data/.
 *
 * Phase 2 will drop real JSON files under assets/data/ and uncomment the
 * require() lines. We keep the files centralised here so the SQL-facing
 * seeder doesn't need to know about Metro resolution.
 */
export interface DataBundleEnvelope<T> {
  version: string;
  source: string;
  entries: T[];
}

export interface IfscPrefixEntry {
  ifsc_prefix: string;
  bank_name: string;
  bank_short_code?: string;
}

export interface SmsSenderEntry {
  sender_code: string;
  bank_name: string;
  bank_type?: string;
  confidence?: number;
}

export interface SmsTemplateEntry {
  id: string;
  bank_name: string;
  template_id?: string;
  pattern_regex: string;
  tx_type: string;
  priority?: number;
}

export interface MccCodeEntry {
  code: string;
  description: string;
  category_name?: string;
}

export interface MerchantBrandEntry {
  id: string;
  brand_canonical: string;
  alias: string;
  category_name?: string;
  mcc_code?: string;
}

/**
 * Safely require a bundle. Returns null if Metro can't resolve the asset
 * (i.e. we haven't shipped the JSON yet). Never throws.
 */
function safeRequire<T>(loader: () => DataBundleEnvelope<T>): DataBundleEnvelope<T> | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

export function loadIfscBundle(): DataBundleEnvelope<IfscPrefixEntry> | null {
  return safeRequire<IfscPrefixEntry>(() =>
    require("../../assets/data/ifsc-prefixes.json") as DataBundleEnvelope<IfscPrefixEntry>,
  );
}

export function loadSmsSenderBundle(): DataBundleEnvelope<SmsSenderEntry> | null {
  return safeRequire<SmsSenderEntry>(() =>
    require("../../assets/data/sms-senders.json") as DataBundleEnvelope<SmsSenderEntry>,
  );
}

export function loadSmsTemplateBundle(): DataBundleEnvelope<SmsTemplateEntry> | null {
  return safeRequire<SmsTemplateEntry>(() =>
    require("../../assets/data/sms-templates.json") as DataBundleEnvelope<SmsTemplateEntry>,
  );
}

export function loadMccBundle(): DataBundleEnvelope<MccCodeEntry> | null {
  return safeRequire<MccCodeEntry>(() =>
    require("../../assets/data/mcc-codes.json") as DataBundleEnvelope<MccCodeEntry>,
  );
}

export function loadMerchantBrandBundle(): DataBundleEnvelope<MerchantBrandEntry> | null {
  return safeRequire<MerchantBrandEntry>(() =>
    require("../../assets/data/merchant-brands.json") as DataBundleEnvelope<MerchantBrandEntry>,
  );
}
