import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { getDatabase } from "@/database";
import { buildAiExport, DEFAULT_AI_EXPORT_SECTIONS, formatAiExportJson, resolveAiExportPeriod } from "@/services/ai-export";
import { AI_EXPORT_MIME_TYPE } from "@/services/ai-export-file";
import { shortRef } from "@/services/ai-reply-format";
import { shareFile } from "@/services/share-file";
import { toIsoDate } from "@/utils/date";
import { buildCorrectionInstructions, CORRECTIONS_FORMAT, FIX_REQUEST } from "./format";
import { getHealthReport } from "./health";
import { accountFixRef } from "./read";

/**
 * The Fix my data file: the user's whole history for their AI assistant, with what it needs to
 * make Arth consistent and correct (docs/AI_CORRECTIONS_DESIGN.md). Built on Export for AI
 * Insights, so it keeps that export's rules: an allow-list of fields, the app's own figures, no SMS
 * text, vault or credentials. On top of it:
 *   - the request and the correction format, in place of the setup reply format,
 *   - the health findings (what Arth already sees is wrong),
 *   - consistency tables: merchant spellings, merchants in several categories,
 *   - every transaction's links and spend type, so a fix can see what's already joined up,
 *   - the names the corrections refer to: accounts (by fix_ref), payment modes, buckets, goals.
 */

export interface FixExport {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  transactions: number;
  findings: number;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json | undefined };

export async function buildFixExport(userId: string, options: { includePeople: boolean; includeNotes: boolean }): Promise<FixExport> {
  const period = await resolveAiExportPeriod("all_time", userId);
  const base = await buildAiExport(userId, {
    ...period,
    sections: { ...DEFAULT_AI_EXPORT_SECTIONS, notes: options.includeNotes, hisaab: true },
    hidePeopleNames: !options.includePeople,
    hideMerchantNames: false,
    suggest: { request: "tidy", includeUnreviewed: true },
  });
  const data = base.data as Record<string, Json | undefined>;
  const db = getDatabase();

  // Each transaction's links and spend type, joined onto its row by ref.
  const rows = await db.getAllAsync<{
    id: string;
    is_right_spend: number | null;
    money_event: string | null;
    reclassified_as_transfer: number | null;
    refund_of_expense_id: string | null;
    bucket: string | null;
  }>(
    `SELECT e.id, e.is_right_spend, e.money_event, e.reclassified_as_transfer, e.refund_of_expense_id,
            (SELECT b.name FROM expense_investment_links l JOIN investment_buckets b ON b.id = l.investment_bucket_id
              WHERE l.expense_id = e.id LIMIT 1) AS bucket
     FROM expenses e WHERE e.user_id = ? AND e.deleted_at IS NULL;`,
    userId,
  );
  const extra = new Map(rows.map((r) => [shortRef("t", r.id), r]));
  if (Array.isArray(data.transactions)) {
    data.transactions = (data.transactions as Record<string, Json>[]).map((t) => {
      const r = extra.get(String(t.ref));
      if (!r) return t;
      return {
        ...t,
        unavoidable: r.is_right_spend == null ? null : r.is_right_spend === 1,
        flagged_as: r.money_event,
        is_transfer: r.reclassified_as_transfer === 1,
        refund_of: r.refund_of_expense_id ? shortRef("t", r.refund_of_expense_id) : null,
        bucket: r.bucket,
      };
    });
  }

  const [health, accounts, modes, buckets, goals] = await Promise.all([
    getHealthReport(userId),
    db.getAllAsync<{ id: string; account_label: string | null; bank_name: string; account_identifier: string | null; account_type: string; credit_limit: number | null }>(
      `SELECT id, account_label, bank_name, account_identifier, account_type, credit_limit FROM financial_accounts
       WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL ORDER BY bank_name;`,
      userId,
    ),
    db.getAllAsync<{ name: string; type: string | null }>(`SELECT name, type FROM payment_modes WHERE user_id = ? AND is_active = 1 ORDER BY name;`, userId),
    db.getAllAsync<{ name: string; annual_target: number; current_contributed: number }>(
      `SELECT name, annual_target, current_contributed FROM investment_buckets WHERE user_id = ? AND is_active = 1;`,
      userId,
    ),
    db.getAllAsync<{ name: string; target_amount: number; target_date: string | null }>(
      `SELECT name, target_amount, target_date FROM life_milestones WHERE user_id = ? AND (is_completed IS NULL OR is_completed = 0);`,
      userId,
    ),
  ]);

  const findings = health.checks.filter((c) => c.count > 0);
  const out: Record<string, Json | undefined> = {
    guide: data.guide,
    format: CORRECTIONS_FORMAT,
    request: FIX_REQUEST,
    reply_instructions: buildCorrectionInstructions(),
    health: {
      score: health.score,
      findings: findings.map((c) => ({ check: c.label, count: c.count, meaning: c.hint })),
      balance_gaps: health.balanceGaps.map((g) => ({
        account: accountFixRef(g.accountId),
        name: g.name,
        bank_says: g.bank,
        on: g.bankDate,
        arth_says: g.arth,
        gap: g.gap,
      })),
      account_type_doubts: health.accountTypeDoubts.map((d) => ({
        account: accountFixRef(d.accountId),
        name: d.name,
        set_as: d.type,
        messages_suggest: d.suggested,
      })),
      merchant_spellings: health.merchantSpellings.slice(0, 300).map((g) => g.names.map((n) => `${n.name} ×${n.count}`)),
      merchants_in_several_categories: health.merchantCategories
        .slice(0, 300)
        .map((m) => ({ merchant: m.merchant, categories: m.categories.map((c) => `${c.name} ×${c.count}`) })),
    },
    accounts_for_fixes: accounts.map((a) => ({
      fix_ref: accountFixRef(a.id),
      name: a.account_label || a.bank_name,
      bank: a.bank_name,
      last4: a.account_identifier ? a.account_identifier.slice(-4) : null,
      type: a.account_type,
      credit_limit: a.credit_limit,
    })),
    payment_modes: modes.map((m) => m.name),
    investment_buckets: buckets.map((b) => ({ name: b.name, annual_target: b.annual_target, contributed: b.current_contributed })),
    goals: goals.map((g) => ({ name: g.name, target_amount: g.target_amount, target_date: g.target_date })),
  };
  // Everything else the base export holds (summary, accounts, budgets, plan, transactions…) after.
  for (const [k, v] of Object.entries(data)) {
    if (!(k in out) && k !== "reply_instructions") out[k] = v;
  }

  const fileName = `arth-fix-my-data_${toIsoDate(new Date())}.json`;
  const file = new File(Paths.cache, fileName);
  try {
    if (file.exists) file.delete();
  } catch {
    // overwritten below
  }
  const json = formatAiExportJson(out);
  file.write(json);
  return {
    filePath: file.uri,
    fileName,
    sizeBytes: file.size ?? json.length,
    transactions: base.counts.transactions,
    findings: findings.length,
  };
}

/** Share sheet on the file, with the request on the clipboard to paste alongside it. */
export async function shareFixExport(file: FixExport): Promise<void> {
  try {
    await Clipboard.setStringAsync(`${FIX_REQUEST} The attached Arth file explains its contents and the exact reply format - follow it.`);
  } catch {
    // The request is in the file too.
  }
  if (await Sharing.isAvailableAsync()) {
    await shareFile(file.filePath, { mimeType: AI_EXPORT_MIME_TYPE, dialogTitle: "Share with your AI assistant" });
  }
}
