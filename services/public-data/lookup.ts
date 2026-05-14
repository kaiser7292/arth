import { getDatabase } from "@/database";
import { BANK_SENDERS } from "@/services/sms/bank-senders";

/**
 * Precedence-aware lookups for public reference data.
 *
 * Precedence order:
 *   1. Hardcoded in-code registries (BANK_SENDERS) — fast, no DB roundtrip,
 *      pre-dates v15 and is the safety net.
 *   2. DB-backed public registries (seeded from assets/data/ in Phase 2).
 *
 * User-authored tables (merchant_aliases, merchant_corrections) are NOT
 * consulted here — callers own the precedence between user data and these
 * public lookups. See services/merchant-alias.ts for the existing
 * user/learned chain.
 *
 * These functions are read-only and safe to call on any thread. They return
 * null for unknown inputs — callers decide the fallback.
 */

export interface ResolvedMerchantBrand {
  canonical: string;
  category: string | null;
  mcc: string | null;
}

export async function resolveBankFromIfsc(ifsc: string): Promise<string | null> {
  const prefix = ifsc.slice(0, 4).toUpperCase();
  if (prefix.length !== 4) return null;

  const db = getDatabase();
  const row = await db.getFirstAsync<{ bank_name: string }>(
    "SELECT bank_name FROM ifsc_bank_registry WHERE ifsc_prefix = ?;",
    prefix,
  );
  return row?.bank_name ?? null;
}

export async function resolveBankFromSender(code: string): Promise<string | null> {
  const normalised = code.toUpperCase();

  // Level 1: hardcoded
  const hit = BANK_SENDERS.find((s) => s.code.toUpperCase() === normalised);
  if (hit) return hit.bank;

  // Level 2: DB-backed
  const db = getDatabase();
  const row = await db.getFirstAsync<{ bank_name: string }>(
    "SELECT bank_name FROM sms_sender_registry WHERE sender_code = ? COLLATE NOCASE;",
    normalised,
  );
  return row?.bank_name ?? null;
}

export async function resolveMerchantBrand(raw: string): Promise<ResolvedMerchantBrand | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    brand_canonical: string;
    category_name: string | null;
    mcc_code: string | null;
  }>(
    "SELECT brand_canonical, category_name, mcc_code FROM merchant_brand_registry WHERE alias = ? COLLATE NOCASE;",
    raw.trim(),
  );

  if (!row) return null;
  return {
    canonical: row.brand_canonical,
    category: row.category_name,
    mcc: row.mcc_code,
  };
}

export async function resolveCategoryFromMcc(code: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ category_name: string | null }>(
    "SELECT category_name FROM mcc_codes WHERE code = ?;",
    code,
  );
  return row?.category_name ?? null;
}
