/**
 * A payment picture goes through what a bank message goes through (services/sms/sms-to-expense.ts),
 * before the add screen opens with it:
 *   1. the merchant name: cleaned, then your merged and renamed names (normalizeMerchantName,
 *      the same call, so it learns new names the same way too)
 *   2. a category from the merchant: learned, keyword and brand mappings (categorizeByMerchant)
 *   3. Smart Rules: category, payment mode, description and discretionary, a rule winning over
 *      the mapping, as on the message path
 * The add screen shows the result, so what you see is what's saved. Saving runs Smart Rules
 * again in createExpense for what a screen can't show (tags, splits, loan and bucket links).
 *
 * Pictures only: entries typed by hand are left as typed. Like a message, this learns new
 * merchant names as it reads them (normalizeMerchantName), so it runs once per Continue.
 */

import { getDatabase } from "@/database";
import { cleanMerchantName, normalizeMerchantName } from "@/services/merchant-alias";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { applyAllRules } from "@/services/smart-rules";
import { formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";

export interface PictureInput {
  merchant: string | null;
  amount: number | null;
  date: string | null;
  accountId: string | null;
  note: string | null;
  /** Money in: left as read (rules still run on save). Names, categories and rules are for spends. */
  credit: boolean;
}

export interface PicturePrefill {
  /** The name to show: your chosen name, or the cleaned one. */
  merchant: string | null;
  /** As the picture had it (cleaned), kept on the transaction so "Separate" can undo a merge. */
  rawMerchant: string | null;
  categoryId: string | null;
  paymentModeId: string | null;
  description: string | null;
  /** 1 unavoidable, 0 discretionary, null not known. */
  isRightSpend: number | null;
}

export async function prepareFromPicture(userId: string, p: PictureInput): Promise<PicturePrefill> {
  const out: PicturePrefill = {
    merchant: p.merchant,
    rawMerchant: p.merchant ? cleanMerchantName(p.merchant) || null : null,
    categoryId: null,
    paymentModeId: null,
    description: null,
    isRightSpend: null,
  };
  // Money in keeps the payer's name as read, as bank-message credits do: payers aren't merchants,
  // and learning them would put people and employers in the spend merchant picker.
  if (p.credit) return out;
  try {
    out.merchant = (await normalizeMerchantName(userId, p.merchant)) ?? p.merchant;
  } catch (e) {
    logger.warn("Picture: merchant names failed (non-fatal)", e);
  }

  try {
    out.categoryId = (await categorizeByMerchant(userId, out.merchant)).categoryId ?? null;
  } catch (e) {
    logger.warn("Picture: category from merchant failed (non-fatal)", e);
  }
  try {
    const rules = await applyAllRules({
      amount: p.amount ?? 0,
      nature: "realized",
      merchant: out.merchant,
      description: p.note,
      category_id: out.categoryId,
      account_id: p.accountId,
      payment_mode_id: null,
      sms_body: null,
      date: p.date ?? formatLocalDate(new Date()),
    });
    if (rules) {
      const r = rules.application;
      if (r.category_id) out.categoryId = r.category_id;
      if (r.payment_mode) out.paymentModeId = r.payment_mode;
      if (r.description) out.description = r.description;
      if (r.is_right_spend !== null) out.isRightSpend = r.is_right_spend;
    }
  } catch (e) {
    logger.warn("Picture: Smart Rules failed (non-fatal)", e);
  }
  if (out.isRightSpend === null && out.categoryId) {
    const c = await getDatabase()
      .getFirstAsync<{ is_unavoidable: number }>(`SELECT is_unavoidable FROM categories WHERE id = ?;`, out.categoryId)
      .catch(() => null);
    if (c) out.isRightSpend = c.is_unavoidable;
  }
  return out;
}
