/**
 * Reconciliation PDF Export — Phase 3
 *
 * Generates a bank-statement-style PDF reconciliation report:
 * - Summary header (account, period, source file)
 * - Match summary (counts + balance comparison)
 * - Matched transactions table
 * - Missing-from-Arth transactions table
 * - Excluded items table
 *
 * Pattern mirrors hisaab-export-pdf.ts: builds HTML → expo-print → file URI.
 * Caller is responsible for sharing the returned URI via expo-sharing.
 */

import * as Print from "expo-print";
import { File, Paths } from "expo-file-system";
import type { ReconciliationSession, ReconciliationItemEnriched } from "./reconciliation-crud";
import type { FinancialAccount } from "@/services/financial-account";
import { formatNumber } from "@/utils/format";
import { getCurrency } from "@/services/locale-preferences";
import { getCurrencyDef } from "@/constants/currencies";

// ─── Helpers ────────────────────────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return formatNumber(n);
}

function sym(): string {
  const code = getCurrency();
  if (code === "NONE") return "";
  return getCurrencyDef(code).symbol;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function accountLabel(account: FinancialAccount | null): string {
  if (!account) return "Unknown Account";
  const parts: string[] = [];
  if (account.account_label) parts.push(account.account_label);
  else if (account.bank_name) parts.push(account.bank_name);
  if (account.account_identifier) parts.push(`****${account.account_identifier}`);
  return parts.join(" ") || "Account";
}

function accountTypeLabel(type: string): string {
  const map: Record<string, string> = {
    savings: "Savings Account",
    bank: "Savings Account",
    credit_card: "Credit Card",
    wallet: "Wallet",
    demat: "Demat Account",
    pension: "Pension",
    loan: "Loan",
  };
  return map[type] ?? type;
}

function excludeReasonLabel(reason: string | null): string {
  const map: Record<string, string> = {
    cashback: "Cashback",
    bank_charge: "Bank charge",
    reward_fee: "Reward / fee",
    refund: "Refund",
    pre_arth: "Pre-Arth period",
    other: "Other",
  };
  return reason ? (map[reason] ?? reason) : "";
}

let cachedLogoBase64: string | null = null;
async function getLogoBase64(): Promise<string> {
  if (cachedLogoBase64) return cachedLogoBase64;
  try {
    const { resolveAssetSource } = require("react-native/Libraries/Image/resolveAssetSource");
    const source = resolveAssetSource(require("@/assets/images/splash-icon.png"));
    if (source?.uri) {
      const response = await fetch(source.uri);
      const blob = await response.blob();
      const b64 = await new Promise<string>((resolve) => {
        const reader = new (globalThis as any).FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });
      cachedLogoBase64 = b64;
      return b64;
    }
  } catch {
    // Non-fatal
  }
  return "";
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function styles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1A1A1A; font-size: 12px; }

    @page { margin: 10px 24px; }

    /* ── Outer page-wrap table ───────────────────────────────────────────
       thead / tfoot repeat on every page — the only cross-WebKit-reliable
       way to get per-page headers and footers in expo-print. */
    table.page-wrap { width: 100%; border-collapse: collapse; }
    table.page-wrap > thead > tr > td,
    table.page-wrap > tfoot > tr > td,
    table.page-wrap > tbody > tr > td { padding: 0; border: none; }

    /* Per-page header */
    .phf {
      background: linear-gradient(135deg, #134E4A 0%, #0F766E 100%);
      color: white; padding: 10px 20px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .phf-brand { display: flex; align-items: center; gap: 8px; }
    .phf-logo { width: 22px; height: 22px; border-radius: 5px; }
    .phf-name { font-size: 14px; font-weight: 800; letter-spacing: 0.4px; }
    .phf-label { font-size: 8px; opacity: 0.65; letter-spacing: 0.3px; margin-top: 1px; }
    .phf-right { text-align: right; }
    .phf-account { font-size: 12px; font-weight: 600; }
    .phf-period { font-size: 9px; opacity: 0.7; margin-top: 2px; }

    /* Per-page footer */
    .pff {
      border-top: 1px solid #E2E8F0;
      padding: 6px 0 3px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 9px; color: #94A3B8;
    }
    .pff-left { font-weight: 600; letter-spacing: 0.5px; }
    .pff-center { flex: 1; text-align: center; }
    .pff-right .pg::after { content: "Page " counter(page); }

    /* Diagonal watermark */
    .watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 72px; font-weight: 900;
      color: rgba(19, 78, 74, 0.04);
      letter-spacing: 16px; white-space: nowrap;
      pointer-events: none; z-index: 0;
    }

    .container { padding: 16px 0; }

    /* Header (page-1 decorative block) */
    .header { background: linear-gradient(135deg, #134E4A 0%, #0F766E 100%); color: white; padding: 24px 20px; margin: -16px 0 20px; }
    .brand { display: flex; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.15); }
    .brand-logo { width: 28px; height: 28px; border-radius: 6px; margin-right: 10px; }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .brand-tagline { font-size: 9px; opacity: 0.7; letter-spacing: 0.3px; margin-top: 1px; }
    .brand-generated { font-size: 9px; opacity: 0.5; margin-left: auto; letter-spacing: 0.3px; align-self: flex-end; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
    .header .subtitle { font-size: 11px; opacity: 0.7; margin-bottom: 12px; }
    .header .meta { display: flex; justify-content: space-between; margin-top: 8px; }
    .header .meta-item { font-size: 11px; }
    .header .meta-label { opacity: 0.6; display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; }
    .header .meta-value { font-weight: 600; font-size: 13px; }

    /* Summary box */
    .summary-box { display: flex; justify-content: space-between; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; }
    .summary-cell .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 3px; }
    .summary-cell .value { font-size: 20px; font-weight: 700; color: #1E293B; }
    .summary-cell .value.matched { color: #22C55E; }
    .summary-cell .value.missing { color: #EF4444; }
    .summary-cell .value.excluded { color: #F59E0B; }

    /* Balance comparison */
    .balance-box { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 18px; margin-bottom: 20px; }
    .balance-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 12px; }
    .balance-row .bal-label { color: #64748B; }
    .balance-row .bal-value { font-weight: 600; color: #1E293B; font-variant-numeric: tabular-nums; }
    .balance-row.diff .bal-label { font-weight: 700; color: #1E293B; }
    .balance-row.diff .bal-value.ok { color: #22C55E; font-weight: 700; }
    .balance-row.diff .bal-value.warn { color: #EF4444; font-weight: 700; }
    .balance-divider { border: none; border-top: 1px solid #E2E8F0; margin: 6px 0; }

    /* Section heading */
    .section-heading { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #CBD5E1; }

    /* Transaction tables */
    .txn-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; table-layout: fixed; }
    .txn-table col.col-date  { width: 8%; }
    .txn-table col.col-narr  { width: 24%; }
    .txn-table col.col-dir   { width: 7%; }
    .txn-table col.col-amt   { width: 10%; }
    .txn-table col.col-arth  { width: 22%; }
    .txn-table col.col-adt   { width: 8%; }
    .txn-table col.col-aamt  { width: 10%; }
    .txn-table col.col-note  { width: 11%; }
    /* Non-matched tables keep original widths */
    .txn-table.simple col.col-narr { width: 42%; }
    .txn-table.simple col.col-amt  { width: 14%; }
    .txn-table.simple col.col-note { width: 24%; }
    .txn-table thead th { background: #F1F5F9; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; padding: 7px 5px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; font-weight: 700; }
    .txn-table thead th.right { text-align: right; }
    .txn-table tbody td { padding: 6px 5px; border-bottom: 1px solid #F1F5F9; font-size: 10px; vertical-align: top; }
    .txn-table tbody td.right { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    .txn-table tbody td.date { white-space: nowrap; color: #64748B; }
    .txn-table tbody td.narr { word-break: break-word; }
    .txn-table tbody td.debit  { color: #EF4444; }
    .txn-table tbody td.credit { color: #22C55E; }
    .badge { display: inline-block; padding: 1px 5px; border-radius: 6px; font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-left: 4px; vertical-align: middle; }
    .badge-auto     { background: #DCFCE7; color: #166534; }
    .badge-suggested{ background: #FEF9C3; color: #92400E; }
    .badge-manual   { background: #EDE9FE; color: #5B21B6; }
    .badge-transfer { background: #EDE9FE; color: #5B21B6; }

    /* Arth match sub-line */
    .arth-match { font-size: 9.5px; color: #64748B; margin-top: 3px; }
    .arth-match-name { font-weight: 600; color: #475569; }

    /* Empty state */
    .empty { text-align: center; padding: 20px; color: #94A3B8; font-size: 11px; }

    /* End-of-document footer — hidden, replaced by tfoot */
    .footer { display: none; }
  `;
}

// ─── HTML builder ────────────────────────────────────────────────────────────

function buildHtml(
  session: ReconciliationSession,
  items: ReconciliationItemEnriched[],
  account: FinancialAccount | null,
  arthBalance: number | null,
  logoBase64: string,
): string {
  const currency = sym();
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  const matched  = items.filter((i) => i.status === "matched");
  const missing  = items.filter((i) => i.status === "unmatched");
  const added    = items.filter((i) => i.status === "added");
  const excluded = items.filter((i) => i.status === "excluded" && i.exclude_reason !== "pre_arth");
  const preArth  = items.filter((i) => i.status === "excluded" && i.exclude_reason === "pre_arth");
  const allExcluded = [...excluded, ...preArth];
  const total = items.length;

  // Balance comparison
  const stmtBal = session.stmt_closing_bal;
  const diff = stmtBal != null && arthBalance != null ? stmtBal - arthBalance : null;
  const diffOk = diff !== null && Math.abs(diff) < 1;

  const logoImg = logoBase64
    ? `<img src="data:image/png;base64,${logoBase64}" class="brand-logo" alt="" />`
    : "";

  // Matched rows
  const matchedRows = matched.length === 0
    ? `<tr><td colspan="5" class="empty">No matched transactions.</td></tr>`
    : matched.map((item) => {
        const confBadge = item.match_confidence === "auto"
          ? `<span class="badge badge-auto">Auto</span>`
          : item.match_confidence === "suggested"
          ? `<span class="badge badge-suggested">Suggested</span>`
          : `<span class="badge badge-manual">Manual</span>`;
        const transferBadge = item.matched_transfer_id
          ? `<span class="badge badge-transfer">Transfer</span>`
          : "";
        const isDebit = item.stmt_direction === "debit";
        const arthMatchParts: string[] = [];
        if (item.arth_description) arthMatchParts.push(item.arth_description);
        if (item.arth_account) arthMatchParts.push(item.arth_account);
        if (item.arth_category) arthMatchParts.push(item.arth_category);
        const arthMatchCell = arthMatchParts.length > 0
          ? `<span class="arth-match-name">${htmlEscape(arthMatchParts[0])}</span>${arthMatchParts.slice(1).length > 0 ? `<div class="arth-match">${htmlEscape(arthMatchParts.slice(1).join(" · "))}</div>` : ""}`
          : "—";
        const arthDateCell = item.arth_date ? fmtDateShort(item.arth_date) : "—";
        const arthAmtCell = item.arth_amount != null
          ? `${currency}${fmt(item.arth_amount)}`
          : "—";
        return `
          <tr>
            <td class="date">${fmtDateShort(item.stmt_date)}</td>
            <td class="narr">${htmlEscape(item.stmt_narration || "—")}</td>
            <td>${isDebit ? "Debit" : "Credit"}</td>
            <td class="right ${isDebit ? "debit" : "credit"}">${currency}${fmt(item.stmt_amount)}</td>
            <td class="narr">${arthMatchCell}</td>
            <td class="date">${arthDateCell}</td>
            <td class="right">${arthAmtCell}</td>
            <td>${confBadge}${transferBadge}</td>
          </tr>`;
      }).join("");

  // Missing rows
  const missingRows = missing.length === 0 && added.length === 0
    ? `<tr><td colspan="4" class="empty">No missing transactions.</td></tr>`
    : [...missing, ...added].map((item) => {
        const isDebit = item.stmt_direction === "debit";
        const addedBadge = item.status === "added" ? `<span class="badge badge-auto">Added</span>` : "";
        return `
          <tr>
            <td class="date">${fmtDateShort(item.stmt_date)}</td>
            <td class="narr">${htmlEscape(item.stmt_narration || "—")}${addedBadge}</td>
            <td>${isDebit ? "Debit" : "Credit"}</td>
            <td class="right ${isDebit ? "debit" : "credit"}">${currency}${fmt(item.stmt_amount)}</td>
          </tr>`;
      }).join("");

  // Excluded rows
  const excludedRows = allExcluded.length === 0
    ? `<tr><td colspan="5" class="empty">No excluded items.</td></tr>`
    : allExcluded.map((item) => {
        const isDebit = item.stmt_direction === "debit";
        return `
          <tr>
            <td class="date">${fmtDateShort(item.stmt_date)}</td>
            <td class="narr">${htmlEscape(item.stmt_narration || "—")}</td>
            <td>${isDebit ? "Debit" : "Credit"}</td>
            <td class="right">${currency}${fmt(item.stmt_amount)}</td>
            <td>${htmlEscape(excludeReasonLabel(item.exclude_reason))}</td>
          </tr>`;
      }).join("");

  const matchPct = total > 0 ? Math.round((matched.length / total) * 100) : 0;
  const statusLabel = session.status === "completed" ? "Reconciled" : "In Progress";

  const periodLabel = `${fmtDate(session.stmt_start_date)} – ${fmtDate(session.stmt_end_date)}`;
  const acctName = htmlEscape(accountLabel(account));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${styles()}</style>
</head>
<body>
<!-- Diagonal watermark — position:fixed centred, repeats on every page -->
<div class="watermark">ARTH</div>
<!-- Outer table: thead / tfoot repeat reliably on every page in WebKit print -->
<table class="page-wrap">
  <thead>
    <tr><td>
      <div class="phf">
        <div class="phf-brand">
          ${logoBase64 ? `<img class="phf-logo" src="data:image/png;base64,${logoBase64}" alt="" />` : ""}
          <div>
            <div class="phf-name">Arth अर्थ</div>
            <div class="phf-label">Reconciliation Report</div>
          </div>
        </div>
        <div class="phf-right">
          <div class="phf-account">${acctName}</div>
          <div class="phf-period">${periodLabel}</div>
        </div>
      </div>
    </td></tr>
  </thead>
  <tfoot>
    <tr><td>
      <div class="pff">
        <span class="pff-left">Arth · अर्थ</span>
        <span class="pff-center">Private Financial Data · ${today}</span>
        <span class="pff-right"><span class="pg"></span></span>
      </div>
    </td></tr>
  </tfoot>
  <tbody><tr><td>
<div class="container">

  <div class="header">
    <div class="brand">
      ${logoImg}
      <div>
        <div class="brand-name">Arth</div>
        <div class="brand-tagline">Personal Finance</div>
      </div>
      <div class="brand-generated">Generated ${today}</div>
    </div>
    <h1>Reconciliation Report</h1>
    <div class="subtitle">${statusLabel} · ${matchPct}% matched</div>
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">Account</span>
        <span class="meta-value">${htmlEscape(accountLabel(account))}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Type</span>
        <span class="meta-value">${htmlEscape(accountTypeLabel(account?.account_type ?? ""))}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Period</span>
        <span class="meta-value">${fmtDate(session.stmt_start_date)} – ${fmtDate(session.stmt_end_date)}</span>
      </div>
      ${session.import_filename ? `<div class="meta-item">
        <span class="meta-label">Source</span>
        <span class="meta-value">${htmlEscape(session.import_filename)}</span>
      </div>` : ""}
    </div>
  </div>

  <!-- Match summary -->
  <div class="summary-box">
    <div class="summary-cell">
      <div class="label">Matched</div>
      <div class="value matched">${matched.length}</div>
    </div>
    <div class="summary-cell">
      <div class="label">Missing</div>
      <div class="value missing">${missing.length}</div>
    </div>
    <div class="summary-cell">
      <div class="label">Excluded</div>
      <div class="value excluded">${allExcluded.length}</div>
    </div>
    <div class="summary-cell">
      <div class="label">Total</div>
      <div class="value">${total}</div>
    </div>
  </div>

  <!-- Balance comparison -->
  ${stmtBal != null ? `
  <div class="balance-box">
    <div class="balance-row">
      <span class="bal-label">Statement closing balance</span>
      <span class="bal-value">${currency}${fmt(stmtBal)}</span>
    </div>
    ${arthBalance != null ? `
    <div class="balance-row">
      <span class="bal-label">Arth computed closing balance</span>
      <span class="bal-value">${currency}${fmt(arthBalance)}</span>
    </div>
    <hr class="balance-divider" />
    <div class="balance-row diff">
      <span class="bal-label">Difference</span>
      <span class="bal-value ${diffOk ? "ok" : "warn"}">${diffOk ? "✓ Balances match" : `${currency}${fmt(Math.abs(diff!))}`}</span>
    </div>` : ""}
  </div>` : ""}

  <!-- Matched -->
  <div class="section-heading">Matched (${matched.length})</div>
  <table class="txn-table">
    <colgroup>
      <col class="col-date" /><col class="col-narr" /><col class="col-dir" /><col class="col-amt" />
      <col class="col-arth" /><col class="col-adt" /><col class="col-aamt" /><col class="col-note" />
    </colgroup>
    <thead>
      <tr>
        <th>Date</th><th>Statement Narration</th><th>Dir</th><th class="right">Stmt Amt</th>
        <th>Arth Match</th><th>Arth Date</th><th class="right">Arth Amt</th><th>Match</th>
      </tr>
    </thead>
    <tbody>${matchedRows}</tbody>
  </table>

  <!-- Missing -->
  <div class="section-heading">Missing from Arth (${missing.length + added.length})</div>
  <table class="txn-table simple">
    <colgroup>
      <col class="col-date" /><col class="col-narr" /><col class="col-dir" /><col class="col-amt" />
    </colgroup>
    <thead>
      <tr>
        <th>Date</th><th>Narration</th><th>Direction</th><th class="right">Amount</th>
      </tr>
    </thead>
    <tbody>${missingRows}</tbody>
  </table>

  <!-- Excluded -->
  <div class="section-heading">Excluded (${allExcluded.length})</div>
  <table class="txn-table simple">
    <colgroup>
      <col class="col-date" /><col class="col-narr" /><col class="col-dir" /><col class="col-amt" /><col class="col-note" />
    </colgroup>
    <thead>
      <tr>
        <th>Date</th><th>Narration</th><th>Direction</th><th class="right">Amount</th><th>Reason</th>
      </tr>
    </thead>
    <tbody>${excludedRows}</tbody>
  </table>

  <div class="footer"></div>

</div>
  </td></tr></tbody>
</table>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates a reconciliation report PDF.
 * Returns the local file URI — caller shares it via expo-sharing.
 */
export async function generateReconciliationPdf(
  session: ReconciliationSession,
  items: ReconciliationItemEnriched[],
  account: FinancialAccount | null,
  arthBalance: number | null,
): Promise<string> {
  const logoBase64 = await getLogoBase64();
  const html = buildHtml(session, items, account, arthBalance, logoBase64);
  const { uri } = await Print.printToFileAsync({ html });

  const acctSlug = accountLabel(account).replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
  const period = session.stmt_start_date.slice(0, 7); // YYYY-MM
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `Arth-Recon-${acctSlug}-${period}-${timestamp}.pdf`;

  const dest = new File(Paths.cache, fileName);
  try { await dest.delete(); } catch { /* non-fatal */ }
  await new File(uri).move(dest);

  return dest.uri;
}
