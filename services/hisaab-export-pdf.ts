/**
 * Hisaab PDF Export Service — V6.0.1
 *
 * Generates bank-statement-style PDF statements with:
 * - Opening balance, date range header
 * - Dr (debit) / Cr (credit+settlement) / Running Balance columns
 * - Totals row with total Dr, total Cr
 * - Closing balance
 *
 * Uses expo-print (HTML -> PDF) + expo-sharing.
 */

import * as Print from "expo-print";
import { File, Paths } from "expo-file-system";
import {
  getPerson,
  getBalanceAsOfDate,
  getEntriesByDateRangeAsc,
  getEntries,
  getPersonBalance,
  enrichEntriesFromExpenses,
} from "@/services/hisaab";
import type { HisaabEntry } from "@/services/hisaab";
import type { ExportDateRange } from "@/components/hisaab/ExportFormatPicker";
import { getCategoryById } from "@/services/category";

// ─── Helpers ───

function htmlEscape(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// v15.9.0: exports honor the user's locale preferences (currency symbol,
// number grouping, date format). All values go through these three helpers,
// which read from MMKV at export time.
import { formatNumber } from "@/utils/format";
import { formatDate as formatDateLocale } from "@/utils/date";
import { getCurrency } from "@/services/locale-preferences";
import { getCurrencyDef } from "@/constants/currencies";

function formatNum(n: number): string {
  return formatNumber(n);
}

function formatDate(dateStr: string): string {
  return formatDateLocale(dateStr);
}

/** Currency symbol prefix for amounts — empty string when user picked "None". */
function currencyPrefix(): string {
  const code = getCurrency();
  if (code === "NONE") return "";
  return getCurrencyDef(code).symbol;
}

// Logo loaded at runtime from the bundled asset via RN's require + fetch.
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
    // Non-fatal — PDF renders without logo
  }
  return "";
}

function formatPeriod(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} — ${formatDate(endDate)}`;
}

function balanceLabel(balance: number): string {
  if (balance > 0) return `${formatNum(balance)} Dr`;
  if (balance < 0) return `${formatNum(Math.abs(balance))} Cr`;
  return "Nil";
}

// ─── HTML Templates ───

function statementStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; color: #1A1A1A; font-size: 12px; }

    @page { margin: 10px 24px; }

    /* ── Outer page-wrap table ───────────────────────────────────────────
       thead / tfoot repeat on every page — the only cross-WebKit-reliable
       way to get per-page headers and footers in expo-print. The old
       position:fixed approach rendered the element once at the document
       origin and appeared at the bottom of page 1 as a bleed artifact. */
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
    .phf-person { font-size: 12px; font-weight: 600; }
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
    /* CSS counter(page) is a WebKit Paged Media extension — renders where supported */
    .pff-right .pg::after { content: "Page " counter(page); }

    /* Diagonal watermark — position:fixed centred on page; repeats reliably */
    .watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 72px; font-weight: 900;
      color: rgba(19, 78, 74, 0.04);
      letter-spacing: 16px; white-space: nowrap;
      pointer-events: none; z-index: 0;
    }

    .stmt-container { padding: 16px 0; }

    /* Header (page-1 decorative block) */
    .stmt-header { background: linear-gradient(135deg, #134E4A 0%, #0F766E 100%); color: white; padding: 24px 20px; margin: -16px 0 20px; }
    .stmt-header .brand { display: flex; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.15); }
    .stmt-header .brand-logo { width: 28px; height: 28px; border-radius: 6px; margin-right: 10px; }
    .stmt-header .brand-text { flex: 1; }
    .stmt-header .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .stmt-header .brand-roman { font-size: 22px; font-weight: 800; margin-left: 8px; letter-spacing: 0.5px; }
    .stmt-header .brand-tagline { font-size: 9px; opacity: 0.7; letter-spacing: 0.3px; }
    .stmt-header .brand-creator { font-size: 9px; opacity: 0.5; margin-left: auto; letter-spacing: 0.3px; }
    .stmt-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; letter-spacing: 0.5px; }
    .stmt-header .subtitle { font-size: 11px; opacity: 0.7; margin-bottom: 12px; }
    .stmt-header .meta { display: flex; justify-content: space-between; margin-top: 8px; }
    .stmt-header .meta-item { font-size: 11px; }
    .stmt-header .meta-label { opacity: 0.6; display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; }
    .stmt-header .meta-value { font-weight: 600; font-size: 13px; }

    /* Info box */
    .info-row { display: flex; justify-content: space-between; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px; margin: 0 0 20px; }
    .info-cell .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 3px; }
    .info-cell .value { font-size: 14px; font-weight: 700; color: #1E293B; }
    .info-cell .value.dr { color: #EF4444; }
    .info-cell .value.cr { color: #22C55E; }
    .info-cell .value.nil { color: #64748B; }

    /* Statement table */
    .stmt-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    .stmt-table { table-layout: fixed; }
    .stmt-table col.col-date { width: 9%; }
    .stmt-table col.col-desc { width: 18%; }
    .stmt-table col.col-cat { width: 12%; }
    .stmt-table col.col-merchant { width: 12%; }
    .stmt-table col.col-account { width: 12%; }
    .stmt-table col.col-amount { width: 13%; }
    .stmt-table thead th { background: #F1F5F9; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; padding: 8px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; font-weight: 700; }
    .stmt-table thead th.right { text-align: right; }
    .stmt-table tbody td { padding: 7px 6px; border-bottom: 1px solid #F1F5F9; font-size: 11px; vertical-align: top; }
    .stmt-table tbody td.right { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    .stmt-table tbody td.dr { color: #EF4444; }
    .stmt-table tbody td.cr { color: #22C55E; }
    .stmt-table tbody td.date { white-space: nowrap; color: #64748B; }
    .stmt-table tbody td.desc { word-break: break-word; }
    .stmt-table tbody td.bal { font-weight: 600; color: #1E293B; }

    /* Totals / closing (after table — uses same table for column alignment) */
    .totals-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .totals-table col.col-text { width: 63%; }
    .totals-table col.col-amt { width: 13%; }
    .totals-table td { padding: 8px 6px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .totals-table td.label { text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; }
    .totals-table td.dr { text-align: right; color: #EF4444; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; }
    .totals-table td.cr { text-align: right; color: #22C55E; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; }
    .totals-table td.value { text-align: right; font-size: 13px; border-top: 2px solid #CBD5E1; border-bottom: 2px solid #CBD5E1; }
    .totals-table td.value.dr { color: #EF4444; }
    .totals-table td.value.cr { color: #22C55E; }
    .totals-table td.value.nil { color: #64748B; }

    /* End-of-content rule separator — no longer used as a floating footer */
    .stmt-footer { display: none; }

    /* Empty state */
    .empty { text-align: center; padding: 32px 20px; color: #94A3B8; font-size: 13px; }

    /* Legend */
    .legend { margin-top: 16px; padding: 10px 14px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; font-size: 10px; color: #92400E; line-height: 1.5; }

    /* Verdict banner */
    .verdict { padding: 12px 18px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; font-weight: 700; text-align: center; }
    .verdict.owes-you { background: #FEF2F2; border: 1px solid #FECACA; color: #EF4444; }
    .verdict.you-owe { background: #F0FDF4; border: 1px solid #BBF7D0; color: #22C55E; }
    .verdict.settled { background: #F8FAFC; border: 1px solid #E2E8F0; color: #64748B; }

    /* Status + type badges */
    .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-left: 4px; vertical-align: middle; }
    .badge-settlement { background: #DBEAFE; color: #1D4ED8; }
    .badge-pending { background: #FEF3C7; color: #B45309; }
    .badge-disputed { background: #FEE2E2; color: #EF4444; }
  `;
}

function personStatementHtml(
  name: string,
  periodLabel: string,
  startDate: string,
  endDate: string,
  openingBalance: number,
  entries: HisaabEntry[],
  totalDebits: number,
  totalCreditsAndSettlements: number,
  closingBalance: number,
  categoryMap: Map<string, string>,
  accountMap: Map<string, string>,
  logoBase64: string,
): string {
  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  // v15.9.0: honor user's currency pref. "None" currency → no symbol.
  const sym = currencyPrefix();

  const obClass = openingBalance > 0 ? "dr" : openingBalance < 0 ? "cr" : "nil";
  const cbClass = closingBalance > 0 ? "dr" : closingBalance < 0 ? "cr" : "nil";

  // Count pending/disputed
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const disputedCount = entries.filter((e) => e.status === "disputed").length;

  // Verdict: from the account holder's (recipient's) perspective
  let verdictText: string;
  let verdictClass: string;
  if (closingBalance > 0) {
    verdictText = `Balance Due: ${sym}${formatNum(closingBalance)}`;
    verdictClass = "owes-you";
  } else if (closingBalance < 0) {
    verdictText = `Credit Balance: ${sym}${formatNum(Math.abs(closingBalance))}`;
    verdictClass = "you-owe";
  } else {
    verdictText = "All Settled — No Balance Due";
    verdictClass = "settled";
  }

  // Build transaction rows with running balance
  let runningBalance = openingBalance;
  const rows = entries
    .map((e) => {
      const isDr = e.type === "debit";
      if (isDr) {
        runningBalance += e.amount;
      } else {
        runningBalance -= e.amount;
      }

      const drCell = isDr ? `${sym}${formatNum(e.amount)}` : "";
      const crCell = !isDr ? `${sym}${formatNum(e.amount)}` : "";
      const balCell = `${sym}${balanceLabel(runningBalance)}`;
      const desc = htmlEscape(e.description || (e.type === "settlement" ? "Settlement" : "—"));
      const categoryName = htmlEscape(e.category_id ? (categoryMap.get(e.category_id) ?? "") : "");
      const merchantName = htmlEscape(e.merchant_name ?? "");
      const accountName = htmlEscape(accountMap.get(e.id) ?? "");

      // Type badge for settlements
      const settlementBadge = e.type === "settlement" ? `<span class="badge badge-settlement">Settlement</span>` : "";

      // Status badge for non-confirmed entries
      let statusBadge = "";
      if (e.status === "pending") statusBadge = `<span class="badge badge-pending">Pending</span>`;
      else if (e.status === "disputed") statusBadge = `<span class="badge badge-disputed">Disputed</span>`;

      return `
        <tr>
          <td class="date">${formatDate(e.date)}</td>
          <td class="desc">${desc}${settlementBadge}${statusBadge}</td>
          <td>${categoryName}</td>
          <td>${merchantName}</td>
          <td>${accountName}</td>
          <td class="right ${isDr ? "dr" : ""}">${drCell}</td>
          <td class="right ${!isDr ? "cr" : ""}">${crCell}</td>
          <td class="right bal">${balCell}</td>
        </tr>
      `;
    })
    .join("");

  const hasEntries = entries.length > 0;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${statementStyles()}</style></head><body>
    <!-- Diagonal watermark — position:fixed centred, repeats on every page -->
    <div class="watermark">ARTH</div>
    <!-- Outer table: thead / tfoot repeat reliably on every page in WebKit print -->
    <table class="page-wrap">
      <thead>
        <tr><td>
          <div class="phf">
            <div class="phf-brand">
              ${logoBase64 ? `<img class="phf-logo" src="data:image/png;base64,${logoBase64}" />` : ""}
              <div>
                <div class="phf-name">Arth अर्थ</div>
                <div class="phf-label">Hisaab Statement</div>
              </div>
            </div>
            <div class="phf-right">
              <div class="phf-person">${htmlEscape(name)}</div>
              <div class="phf-period">${formatPeriod(startDate, endDate)}</div>
            </div>
          </div>
        </td></tr>
      </thead>
      <tfoot>
        <tr><td>
          <div class="pff">
            <span class="pff-left">Arth · अर्थ</span>
            <span class="pff-center">Your Finance, Your Way · Created by Sourav Baid · ${today}</span>
            <span class="pff-right"><span class="pg"></span></span>
          </div>
        </td></tr>
      </tfoot>
      <tbody><tr><td>
    <div class="stmt-container">
      <div class="stmt-header">
        <div class="brand">
          ${logoBase64 ? `<img class="brand-logo" src="data:image/png;base64,${logoBase64}" />` : ""}
          <div class="brand-text">
            <span class="brand-name">Arth</span><span class="brand-roman">अर्थ</span>
            <span class="brand-tagline"> · Your Finance, Your Way</span>
          </div>
          <span class="brand-creator">Created by Sourav Baid</span>
        </div>
        <h1>HISAAB STATEMENT</h1>
        <div class="subtitle">Account of: ${htmlEscape(name)}</div>
        <div class="meta">
          <div class="meta-item">
            <span class="meta-label">Period</span>
            <span class="meta-value">${formatPeriod(startDate, endDate)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Generated</span>
            <span class="meta-value">${today}</span>
          </div>
        </div>
      </div>

      <div class="verdict ${verdictClass}">${verdictText}</div>

      <div class="info-row">
        <div class="info-cell">
          <div class="label">Opening Balance</div>
          <div class="value ${obClass}">${sym}${balanceLabel(openingBalance)}</div>
        </div>
        <div class="info-cell">
          <div class="label">Total Debits</div>
          <div class="value dr">${hasEntries ? `${sym}${formatNum(totalDebits)}` : "—"}</div>
        </div>
        <div class="info-cell">
          <div class="label">Total Credits</div>
          <div class="value cr">${hasEntries ? `${sym}${formatNum(totalCreditsAndSettlements)}` : "—"}</div>
        </div>
        <div class="info-cell">
          <div class="label">Closing Balance</div>
          <div class="value ${cbClass}">${sym}${balanceLabel(closingBalance)}</div>
        </div>
      </div>

      ${(pendingCount > 0 || disputedCount > 0) ? `
        <div style="margin-bottom: 12px; padding: 8px 14px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 6px; font-size: 10px; color: #92400E;">
          ${pendingCount > 0 ? `<strong>${pendingCount}</strong> pending` : ""}${pendingCount > 0 && disputedCount > 0 ? " · " : ""}${disputedCount > 0 ? `<strong>${disputedCount}</strong> disputed` : ""} transaction${(pendingCount + disputedCount) > 1 ? "s" : ""} in this period
        </div>
      ` : ""}

      ${hasEntries ? `
        <table class="stmt-table">
          <colgroup>
            <col class="col-date" />
            <col class="col-desc" />
            <col class="col-cat" />
            <col class="col-merchant" />
            <col class="col-account" />
            <col class="col-amount" />
            <col class="col-amount" />
            <col class="col-amount" />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Merchant</th>
              <th>Account</th>
              <th class="right">Debit (Dr)</th>
              <th class="right">Credit (Cr)</th>
              <th class="right">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <table class="totals-table">
          <colgroup>
            <col class="col-text" />
            <col class="col-amt" />
            <col class="col-amt" />
            <col class="col-amt" />
          </colgroup>
          <tr>
            <td class="label">Totals / Closing</td>
            <td class="dr">${sym}${formatNum(totalDebits)}</td>
            <td class="cr">${sym}${formatNum(totalCreditsAndSettlements)}</td>
            <td class="value ${cbClass}">${sym}${balanceLabel(closingBalance)}</td>
          </tr>
        </table>
      ` : `<p class="empty">No transactions in this period.</p>`}

      <div class="legend">
        <strong>Dr (Debit)</strong> = they spent on your behalf / they owe you more · <strong>Cr (Credit)</strong> = you paid them back / settled dues<br>
        <strong>Balance Dr</strong> = net amount they owe you · <strong>Balance Cr</strong> = net amount you owe them · <strong>Nil</strong> = settled
      </div>

    </div>
      </td></tr></tbody>
    </table>
  </body></html>`;
}


// ─── Public API ───

/**
 * Generate a bank-statement-style PDF for one hisaab person with date range.
 * Returns the temporary file URI.
 */
export async function generatePersonPDF(
  personId: string,
  userId: string,
  dateRange?: ExportDateRange,
): Promise<string> {
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");

  let openingBalance: number;
  let entries: HisaabEntry[];
  let startDate: string;
  let endDate: string;
  let periodLabel: string;

  if (dateRange) {
    startDate = dateRange.startDate;
    endDate = dateRange.endDate;
    periodLabel = dateRange.label;

    const [ob, rangeEntries] = await Promise.all([
      getBalanceAsOfDate(personId, startDate),
      getEntriesByDateRangeAsc(personId, startDate, endDate),
    ]);
    openingBalance = ob;
    entries = rangeEntries;
  } else {
    // Fallback: all entries
    startDate = "2000-01-01";
    endDate = "2099-12-31";
    periodLabel = "All Time";
    openingBalance = person.initial_balance;
    const allEntries = await getEntries(personId);
    // Reverse to ASC for statement
    entries = [...allEntries].reverse();
  }

  // Compute totals
  const totalDebits = entries
    .filter((e) => e.type === "debit")
    .reduce((s, e) => s + e.amount, 0);
  const totalCredits = entries
    .filter((e) => e.type !== "debit")
    .reduce((s, e) => s + e.amount, 0);
  const closingBalance = openingBalance + totalDebits - totalCredits;

  // Enrich entries from linked expenses (fills missing category/merchant, builds account map)
  const accountMap = await enrichEntriesFromExpenses(entries);

  // Resolve category names
  const categoryMap = new Map<string, string>();
  const uniqueCatIds = new Set(entries.map((e) => e.category_id).filter(Boolean) as string[]);
  for (const catId of uniqueCatIds) {
    const cat = await getCategoryById(catId);
    if (cat) categoryMap.set(catId, cat.name);
  }

  const logoBase64 = await getLogoBase64();

  const html = personStatementHtml(
    person.name,
    periodLabel,
    startDate,
    endDate,
    openingBalance,
    entries,
    totalDebits,
    totalCredits,
    closingBalance,
    categoryMap,
    accountMap,
    logoBase64,
  );

  const { uri } = await Print.printToFileAsync({ html });

  const safeName = person.name.replace(/[^a-zA-Z0-9]/g, "_");
  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
  // v16.0.8 — second-level timestamp so back-to-back exports don't collide.
  // Previous date-only timestamp (`YYYY-MM-DD`) let a second export in the
  // same day throw `FileAlreadyExistsException` from `File.move()`.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `Hisaab_${safeName}_${safePeriod}_${timestamp}.pdf`;
  const dest = new File(Paths.cache, fileName);
  // Defensive: if a file with this exact name somehow exists (clock skew,
  // leftover from a crashed run), delete it so `move` doesn't trip.
  try {
    if (dest.exists) dest.delete();
  } catch {
    // Non-fatal; `move` will raise a clearer error if this matters.
  }
  await new File(uri).move(dest);

  return dest.uri;
}


/**
 * Generate HTML for a person statement (exposed for testing).
 */
export { personStatementHtml as _personStatementHtml };

