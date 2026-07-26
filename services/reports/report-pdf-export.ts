import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { formatNumber } from "@/utils/format";
import { formatDate as formatDateLocale } from "@/utils/date";
import { getCurrency } from "@/services/locale-preferences";
import { getCurrencyDef } from "@/constants/currencies";
import type { FinancialHealthReport } from "./financial-health-report";
import type { RetirementReport } from "./retirement-report";
import type { LoanPayoffReport } from "./loan-payoff-report";
import type { SpendingPersonalityReport } from "./spending-personality-report";

// ─── Helpers ───

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNum(n: number): string {
  return formatNumber(n);
}

function currencyPrefix(): string {
  const code = getCurrency();
  if (code === "NONE") return "";
  return getCurrencyDef(code).symbol;
}

function fmtAmt(n: number): string {
  return `${currencyPrefix()}${formatNum(n)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

function fmtDate(iso: string): string {
  return formatDateLocale(iso) ?? iso;
}

function todayFormatted(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Logo ───

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

// ─── Shared HTML infrastructure ───

function baseStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1A1A1A; font-size: 12px; line-height: 1.5; }
    @page { margin: 10px 24px; }

    table.page-wrap { width: 100%; border-collapse: collapse; }
    table.page-wrap > thead > tr > td,
    table.page-wrap > tfoot > tr > td,
    table.page-wrap > tbody > tr > td { padding: 0; border: none; }

    .phf { background: linear-gradient(135deg, #134E4A 0%, #0F766E 100%); color: white; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; }
    .phf-brand { display: flex; align-items: center; gap: 8px; }
    .phf-logo { width: 22px; height: 22px; border-radius: 5px; }
    .phf-name { font-size: 14px; font-weight: 800; letter-spacing: 0.4px; }
    .phf-label { font-size: 8px; opacity: 0.65; letter-spacing: 0.3px; margin-top: 1px; }
    .phf-right { text-align: right; }

    .pff { border-top: 1px solid #E2E8F0; padding: 6px 0 3px; display: flex; align-items: center; justify-content: space-between; font-size: 9px; color: #94A3B8; }
    .pff-left { font-weight: 600; letter-spacing: 0.5px; }
    .pff-right .pg::after { content: "Page " counter(page); }

    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 72px; font-weight: 900; color: rgba(19, 78, 74, 0.04); letter-spacing: 16px; white-space: nowrap; pointer-events: none; }

    .report-header { background: linear-gradient(135deg, #134E4A 0%, #0F766E 100%); color: white; padding: 24px 20px; margin: -16px 0 20px; }
    .report-header .brand { display: flex; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.15); }
    .report-header .brand-logo { width: 28px; height: 28px; border-radius: 6px; margin-right: 10px; }
    .report-header .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .report-header h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
    .report-header .subtitle { font-size: 11px; opacity: 0.7; }
    .report-header .meta { display: flex; justify-content: space-between; margin-top: 12px; }
    .report-header .meta-item .label { font-size: 9px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
    .report-header .meta-item .value { font-size: 13px; font-weight: 600; }

    .card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px; margin-bottom: 12px; }
    .card-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 8px; font-weight: 600; }

    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat-box { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 14px; }
    .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 3px; }
    .stat-value { font-size: 16px; font-weight: 700; color: #1E293B; }
    .stat-value.green { color: #22C55E; }
    .stat-value.red { color: #EF4444; }
    .stat-value.amber { color: #F59E0B; }

    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #0F766E; font-weight: 700; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #0F766E; }

    .data-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
    .data-table th { text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; border-bottom: 2px solid #E2E8F0; font-weight: 600; }
    .data-table td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table .amount { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }

    .progress-bar { height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; }

    .grade-badge { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; font-size: 18px; font-weight: 800; }

    .risk-item { border-left: 3px solid; padding: 8px 12px; margin-bottom: 8px; background: #F8FAFC; border-radius: 0 6px 6px 0; }
    .risk-item.critical { border-color: #EF4444; }
    .risk-item.high { border-color: #F59E0B; }
    .risk-item.medium { border-color: #3B82F6; }
    .risk-title { font-size: 11px; font-weight: 700; margin-bottom: 2px; }
    .risk-desc { font-size: 10px; color: #64748B; }

    .action-item { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
    .action-num { width: 22px; height: 22px; border-radius: 50%; background: #0F766E; color: white; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .action-title { font-size: 11px; font-weight: 700; }
    .action-desc { font-size: 10px; color: #64748B; }

    .disclaimer { margin-top: 20px; padding: 10px 14px; background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 6px; font-size: 9px; color: #92400E; }
  `;
}

function pageHeader(reportTitle: string, logoBase64: string): string {
  return `
    <div class="phf">
      <div class="phf-brand">
        ${logoBase64 ? `<img class="phf-logo" src="data:image/png;base64,${logoBase64}" />` : ""}
        <div>
          <div class="phf-name">Arth &middot; &#2309;&#2352;&#2381;&#2341;</div>
          <div class="phf-label">${htmlEscape(reportTitle)}</div>
        </div>
      </div>
      <div class="phf-right">
        <div style="font-size: 9px; opacity: 0.7;">Personal Finance</div>
      </div>
    </div>
  `;
}

function pageFooter(generatedDate: string): string {
  return `
    <div class="pff">
      <span class="pff-left">Arth &middot; &#2309;&#2352;&#2381;&#2341;</span>
      <span style="flex: 1; text-align: center;">${htmlEscape(generatedDate)}</span>
      <span class="pff-right"><span class="pg"></span></span>
    </div>
  `;
}

function reportHeaderHtml(
  title: string,
  subtitle: string,
  logoBase64: string,
  metaItems: { label: string; value: string }[],
): string {
  const metaHtml = metaItems
    .map(
      (m) => `
      <div class="meta-item">
        <div class="label">${htmlEscape(m.label)}</div>
        <div class="value">${htmlEscape(m.value)}</div>
      </div>`,
    )
    .join("");

  return `
    <div class="report-header">
      <div class="brand">
        ${logoBase64 ? `<img class="brand-logo" src="data:image/png;base64,${logoBase64}" />` : ""}
        <span class="brand-name">Arth &middot; &#2309;&#2352;&#2381;&#2341;</span>
      </div>
      <h1>${htmlEscape(title)}</h1>
      <div class="subtitle">${htmlEscape(subtitle)}</div>
      <div class="meta">${metaHtml}</div>
    </div>
  `;
}

function disclaimerHtml(): string {
  return `
    <div class="disclaimer">
      <strong>Disclaimer:</strong> This report is generated from your personal financial data stored locally on your device.
      It is for informational purposes only and does not constitute financial advice.
      Consult a qualified financial advisor before making investment or financial decisions.
      Past performance does not guarantee future results. All projections are estimates based on stated assumptions.
    </div>
  `;
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#22C55E";
  if (grade.startsWith("B")) return "#3B82F6";
  if (grade.startsWith("C")) return "#F59E0B";
  return "#EF4444";
}

function wrapPage(
  body: string,
  _reportTitle: string,
  _logoBase64: string,
  generatedDate: string,
): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles()}</style></head><body>
    <div class="watermark">ARTH</div>
    <table class="page-wrap">
      <tfoot><tr><td>${pageFooter(generatedDate)}</td></tr></tfoot>
      <tbody><tr><td>${body}</td></tr></tbody>
    </table>
  </body></html>`;
}

// ─── PDF generation ───

async function generatePDF(html: string, filename: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const dir = Paths.cache;
  const dest = `${dir.uri}/${filename}`;
  const destFile = new File(dest);
  if (destFile.exists) destFile.delete();
  const srcFile = new File(uri);
  await srcFile.move(destFile);
  return dest;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ─── Financial Health PDF ───

export async function exportFinancialHealthPDF(
  report: FinancialHealthReport,
): Promise<string> {
  const logoBase64 = await getLogoBase64();
  const today = todayFormatted();

  const dimensionRows = report.dimensions
    .map(
      (d) => `
      <tr>
        <td>
          <span class="grade-badge" style="background: ${gradeColor(d.grade)}20; color: ${gradeColor(d.grade)}; width: 28px; height: 28px; font-size: 12px;">${htmlEscape(d.grade)}</span>
        </td>
        <td style="font-weight: 600;">${htmlEscape(d.name)}</td>
        <td>${d.score}/100</td>
        <td style="color: #64748B; font-size: 10px;">${htmlEscape(d.description)}</td>
      </tr>`,
    )
    .join("");

  const assetRows = report.assetBreakdown
    .map(
      (a) => `
      <tr>
        <td>${htmlEscape(a.label)}</td>
        <td style="color: #64748B; font-size: 10px;">${htmlEscape(a.group)}</td>
        <td class="amount">${fmtAmt(a.amount)}</td>
      </tr>`,
    )
    .join("");

  const liabilityRows = report.liabilityBreakdown
    .map(
      (l) => `
      <tr>
        <td>${htmlEscape(l.label)}</td>
        <td style="color: #64748B; font-size: 10px;">${htmlEscape(l.group)}</td>
        <td class="amount" style="color: #EF4444;">${fmtAmt(l.amount)}</td>
      </tr>`,
    )
    .join("");

  const savingsRows = report.monthlySavingsRates
    .map(
      (m) => `
      <tr>
        <td>${htmlEscape(m.month)}</td>
        <td class="amount">${fmtAmt(m.income)}</td>
        <td class="amount">${fmtAmt(m.expenses)}</td>
        <td class="amount">${fmtAmt(m.saved)}</td>
        <td class="amount" style="color: ${m.rate >= 30 ? "#22C55E" : m.rate >= 15 ? "#F59E0B" : "#EF4444"};">${fmtPct(m.rate)}</td>
      </tr>`,
    )
    .join("");

  const categoryRows = report.categoryBreakdown
    .slice(0, 15)
    .map(
      (c) => `
      <tr>
        <td>${htmlEscape(c.categoryName)}</td>
        <td class="amount">${fmtAmt(c.amount)}</td>
        <td class="amount">${fmtPct(c.percentage)}</td>
        <td style="width: 30%;">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(c.percentage, 100)}%; background: #0F766E;"></div>
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const spikeRows = report.spikingCategories
    .map(
      (s) => `
      <div class="risk-item high">
        <div class="risk-title">${htmlEscape(s.categoryName)} &mdash; ${s.spikeMultiple}x spike</div>
        <div class="risk-desc">Current: ${fmtAmt(s.currentMonth)} vs 3-month avg: ${fmtAmt(s.avgPrevious)}</div>
      </div>`,
    )
    .join("");

  const body = `
    <div style="padding: 16px 0;">
      ${reportHeaderHtml("Financial Health Report", report.gradeSummary, logoBase64, [
        { label: "Data As Of", value: fmtDate(report.dataAsOf) },
        { label: "Generated", value: today },
      ])}

      <div class="card" style="text-align: center; margin-bottom: 16px;">
        <div class="card-title">Overall Grade</div>
        <div class="grade-badge" style="background: ${gradeColor(report.overallGrade)}20; color: ${gradeColor(report.overallGrade)}; margin: 8px auto;">${htmlEscape(report.overallGrade)}</div>
        <div style="font-size: 11px; color: #64748B; margin-top: 6px;">${htmlEscape(report.gradeSummary)}</div>
      </div>

      <table class="data-table">
        <thead><tr><th></th><th>Dimension</th><th>Score</th><th>Details</th></tr></thead>
        <tbody>${dimensionRows}</tbody>
      </table>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Net Worth</div>
          <div class="stat-value ${report.netWorth >= 0 ? "green" : "red"}">${fmtAmt(report.netWorth)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Savings Rate</div>
          <div class="stat-value ${report.currentSavingsRate >= 30 ? "green" : report.currentSavingsRate >= 15 ? "amber" : "red"}">${fmtPct(report.currentSavingsRate)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Debt-to-Income</div>
          <div class="stat-value ${report.debtToIncomeRatio <= 20 ? "green" : report.debtToIncomeRatio <= 35 ? "amber" : "red"}">${fmtPct(report.debtToIncomeRatio)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Emergency Fund</div>
          <div class="stat-value ${report.emergencyMonths >= 6 ? "green" : report.emergencyMonths >= 3 ? "amber" : "red"}">${report.emergencyMonths} months</div>
        </div>
      </div>

      <div class="section-title">Net Worth Breakdown</div>
      <div style="margin-bottom: 8px; font-size: 11px; font-weight: 600;">
        Assets: <span style="color: #22C55E;">${fmtAmt(report.totalAssets)}</span>
        &nbsp;&middot;&nbsp;
        Liabilities: <span style="color: #EF4444;">${fmtAmt(report.totalLiabilities)}</span>
      </div>
      ${assetRows ? `
        <table class="data-table">
          <thead><tr><th>Asset</th><th>Type</th><th style="text-align: right;">Amount</th></tr></thead>
          <tbody>${assetRows}</tbody>
        </table>
      ` : ""}
      ${liabilityRows ? `
        <table class="data-table">
          <thead><tr><th>Liability</th><th>Type</th><th style="text-align: right;">Amount</th></tr></thead>
          <tbody>${liabilityRows}</tbody>
        </table>
      ` : ""}

      ${savingsRows ? `
        <div class="section-title">Savings Rate Trend</div>
        <table class="data-table">
          <thead><tr><th>Month</th><th style="text-align: right;">Income</th><th style="text-align: right;">Expenses</th><th style="text-align: right;">Saved</th><th style="text-align: right;">Rate</th></tr></thead>
          <tbody>${savingsRows}</tbody>
        </table>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 16px;">Average savings rate: <strong>${fmtPct(report.avgSavingsRate)}</strong></div>
      ` : ""}

      ${categoryRows ? `
        <div class="section-title">Expense Composition</div>
        <table class="data-table">
          <thead><tr><th>Category</th><th style="text-align: right;">Amount</th><th style="text-align: right;">Share</th><th></th></tr></thead>
          <tbody>${categoryRows}</tbody>
        </table>
      ` : ""}

      ${report.spikingCategories.length > 0 ? `
        <div class="section-title">Spending Discipline</div>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 8px;">Categories spending 2x+ their 3-month average</div>
        ${spikeRows}
      ` : ""}

      ${disclaimerHtml()}
    </div>
  `;

  const html = wrapPage(body, "Financial Health Report", logoBase64, today);
  return generatePDF(html, `Financial_Health_${timestamp()}.pdf`);
}

// ─── Retirement PDF ───

export async function exportRetirementPDF(
  report: RetirementReport,
): Promise<string> {
  const logoBase64 = await getLogoBase64();
  const today = todayFormatted();

  const scenarioRows = report.scenarios
    .map(
      (s) => `
      <tr>
        <td style="font-weight: 600;">${htmlEscape(s.label)}</td>
        <td class="amount">${fmtPct(s.returnPct)}</td>
        <td class="amount">${fmtAmt(Math.round(s.projectedCorpus))}</td>
        <td style="text-align: center;">
          <span style="color: ${s.isAchievable ? "#22C55E" : "#EF4444"}; font-weight: 700;">${s.isAchievable ? "Yes" : "No"}</span>
        </td>
      </tr>`,
    )
    .join("");

  const phaseRows = report.phases
    .map(
      (p) => `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-weight: 700; font-size: 12px;">${htmlEscape(p.name)}</span>
          <span style="font-size: 10px; color: #64748B;">${htmlEscape(p.yearRange)}</span>
        </div>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 6px;">
          Est. income: ${htmlEscape(p.monthlyIncomeEstimate)}/mo &middot; SIP target: ${htmlEscape(p.sipTarget)}/mo
        </div>
        <div style="font-size: 10px;">
          <strong>Goals:</strong> ${p.goals.map((g) => htmlEscape(g)).join(", ")}
        </div>
        <div style="font-size: 10px; margin-top: 4px;">
          ${p.keyActions.map((a) => `<div style="margin-left: 8px;">&bull; ${htmlEscape(a)}</div>`).join("")}
        </div>
      </div>`,
    )
    .join("");

  const riskRows = report.risks
    .map(
      (r) => `
      <div class="risk-item ${r.severity}">
        <div class="risk-title">${htmlEscape(r.title)}</div>
        <div class="risk-desc">${htmlEscape(r.description)}</div>
      </div>`,
    )
    .join("");

  const actionRows = report.actions
    .map(
      (a) => `
      <div class="action-item">
        <div class="action-num">${a.priority}</div>
        <div>
          <div class="action-title">${htmlEscape(a.title)}</div>
          <div class="action-desc">${htmlEscape(a.description)}</div>
        </div>
      </div>`,
    )
    .join("");

  const childEdSection = report.childEducation
    ? `
      <div class="section-title">Child Education</div>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Cost Today</div>
          <div class="stat-value">${fmtAmt(Math.round(report.childEducation.costTodayTotal))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Inflation-Adjusted Cost</div>
          <div class="stat-value red">${fmtAmt(Math.round(report.childEducation.costInflated))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Monthly SIP Needed</div>
          <div class="stat-value">${fmtAmt(Math.round(report.childEducation.monthlySIPNeeded))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Projected Corpus</div>
          <div class="stat-value green">${fmtAmt(Math.round(report.childEducation.projectedCorpus))}</div>
        </div>
      </div>
    `
    : "";

  const readinessColor = report.readinessScore >= 70 ? "#22C55E" : report.readinessScore >= 40 ? "#F59E0B" : "#EF4444";

  const corpusMilestoneRows = report.corpusMilestones
    .map(
      (cm) => `
      <tr>
        <td>${cm.year}</td>
        <td>${cm.age}</td>
        <td class="amount">${fmtAmt(Math.round(cm.sipMonthly))}</td>
        <td class="amount" style="font-weight: 600;">${fmtAmt(Math.round(cm.corpusAccumulated))}</td>
      </tr>`,
    )
    .join("");

  const drawdownRows = report.drawdownPlan
    .map(
      (d) => `
      <tr>
        <td>${fmtPct(d.withdrawalRate)}</td>
        <td class="amount">${fmtAmt(Math.round(d.annualWithdrawal))}</td>
        <td class="amount" style="font-weight: 600; color: ${d.sustainable ? "#22C55E" : "#EF4444"};">${d.corpusLastsYears >= 60 ? "60+" : d.corpusLastsYears} years</td>
        <td style="text-align: center; color: ${d.sustainable ? "#22C55E" : "#EF4444"}; font-weight: 600;">${d.sustainable ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  const milestoneRows = report.milestones
    .map(
      (m) => `
      <div class="card" style="margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: 700; font-size: 11px;">${htmlEscape(m.name)}</span>
          <span style="font-weight: 700; font-size: 11px; color: #0F766E;">${fmtAmt(Math.round(m.targetAmount))}</span>
        </div>
        <div style="height: 4px; background: #E2E8F0; border-radius: 2px; overflow: hidden; margin-bottom: 4px;">
          <div style="height: 100%; width: ${m.progressPct}%; background: ${m.progressPct >= 50 ? "#22C55E" : "#F59E0B"}; border-radius: 2px;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748B;">
          <span>${fmtAmt(Math.round(m.currentSaved))} saved · ${m.progressPct}%</span>
          <span>${fmtAmt(Math.round(m.monthlyNeeded))}/mo needed</span>
        </div>
        <div style="font-size: 9px; color: #64748B; margin-top: 2px;">${htmlEscape(m.impactOnRetirement)}</div>
      </div>`,
    )
    .join("");

  const body = `
    <div style="padding: 16px 0;">
      ${reportHeaderHtml("Retirement Readiness Report", "Plan your financial independence", logoBase64, [
        { label: "Current Age", value: String(report.currentAge) },
        { label: "Retirement Age", value: String(report.inputs.retirementAge) },
        { label: "Target Corpus", value: fmtAmt(Math.round(report.targetCorpus)) },
        { label: "Generated", value: today },
      ])}

      <div class="card" style="text-align: center; margin-bottom: 12px;">
        <div style="font-size: 36px; font-weight: 800; color: ${readinessColor};">${report.readinessScore}/100</div>
        <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${htmlEscape(report.readinessLabel)}</div>
        <div style="height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; margin-top: 8px;">
          <div style="height: 100%; width: ${report.readinessScore}%; background: ${readinessColor}; border-radius: 3px;"></div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Monthly Income</div>
          <div class="stat-value">${fmtAmt(Math.round(report.currentMonthlyInHand))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Monthly Expenses</div>
          <div class="stat-value">${fmtAmt(Math.round(report.currentMonthlyExpenses))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Savings Rate</div>
          <div class="stat-value ${report.currentSavingsRate >= 30 ? "green" : report.currentSavingsRate >= 15 ? "amber" : "red"}">${fmtPct(report.currentSavingsRate)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Monthly Surplus</div>
          <div class="stat-value ${report.currentMonthlySurplus >= 0 ? "green" : "red"}">${fmtAmt(Math.round(report.currentMonthlySurplus))}</div>
        </div>
      </div>

      <div class="section-title">Corpus Math</div>
      <div class="card">
        <table class="data-table" style="margin-bottom: 0;">
          <tbody>
            <tr><td>Monthly expense at retirement (today's value)</td><td class="amount">${fmtAmt(Math.round(report.retirementMonthlyExpenseToday))}</td></tr>
            <tr><td>Monthly expense at retirement (inflation-adjusted)</td><td class="amount">${fmtAmt(Math.round(report.retirementMonthlyExpenseInflated))}</td></tr>
            <tr><td>Target corpus (28x annual expenses)</td><td class="amount" style="font-weight: 700;">${fmtAmt(Math.round(report.targetCorpus))}</td></tr>
            <tr><td>Existing assets at retirement (projected)</td><td class="amount green">${fmtAmt(Math.round(report.existingAssetsAtRetirement))}</td></tr>
            <tr><td>Gap to fill</td><td class="amount ${report.gapToFill > 0 ? "red" : "green"}" style="font-weight: 700;">${fmtAmt(Math.round(report.gapToFill))}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="section-title">SIP Plan</div>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Required Monthly SIP</div>
          <div class="stat-value">${fmtAmt(Math.round(report.requiredMonthlySIP))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Annual Step-Up</div>
          <div class="stat-value">${fmtPct(report.sipAnnualStepUpPct)}</div>
        </div>
      </div>

      <div class="section-title">Scenarios</div>
      <table class="data-table">
        <thead><tr><th>Scenario</th><th style="text-align: right;">Return</th><th style="text-align: right;">Projected Corpus</th><th style="text-align: center;">Achievable</th></tr></thead>
        <tbody>${scenarioRows}</tbody>
      </table>

      ${report.corpusMilestones.length > 0 ? `
        <div class="section-title">Corpus Growth Roadmap</div>
        <table class="data-table">
          <thead><tr><th>Year</th><th>Age</th><th style="text-align: right;">SIP/mo</th><th style="text-align: right;">Corpus</th></tr></thead>
          <tbody>${corpusMilestoneRows}</tbody>
        </table>
      ` : ""}

      <div class="section-title">Phase Plan</div>
      ${phaseRows}

      ${report.drawdownPlan.length > 0 ? `
        <div class="section-title">Post-Retirement Drawdown</div>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 6px;">How long your corpus lasts at different withdrawal rates</div>
        <table class="data-table">
          <thead><tr><th>Rate</th><th style="text-align: right;">Annual Withdrawal</th><th style="text-align: right;">Lasts</th><th style="text-align: center;">Sustainable</th></tr></thead>
          <tbody>${drawdownRows}</tbody>
        </table>
      ` : ""}

      ${report.milestones.length > 0 ? `
        <div class="section-title">Life Milestones</div>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 6px;">Active milestones and their impact on your retirement plan</div>
        ${milestoneRows}
      ` : ""}

      ${childEdSection}

      ${report.risks.length > 0 ? `
        <div class="section-title">Risk Flags</div>
        ${riskRows}
      ` : ""}

      ${report.actions.length > 0 ? `
        <div class="section-title">Action Items</div>
        ${actionRows}
      ` : ""}

      ${disclaimerHtml()}
      <div style="margin-top: 8px; font-size: 9px; color: #92400E;">
        <strong>Assumptions:</strong>
        Expected return: ${fmtPct(report.inputs.expectedReturnPct)} &middot;
        Inflation: ${fmtPct(report.inputs.inflationPct)} &middot;
        Salary growth: ${fmtPct(report.inputs.salaryGrowthPct)} &middot;
        Life expectancy: ${report.inputs.lifeExpectancy} years &middot;
        Retirement portfolio yield: ${fmtPct(report.inputs.retirementPortfolioYieldPct)}
      </div>
    </div>
  `;

  const html = wrapPage(body, "Retirement Readiness Report", logoBase64, today);
  return generatePDF(html, `Retirement_Report_${timestamp()}.pdf`);
}

// ─── Loan Payoff PDF ───

export async function exportLoanPayoffPDF(
  report: LoanPayoffReport,
): Promise<string> {
  const logoBase64 = await getLogoBase64();
  const today = todayFormatted();

  const loanRows = report.loans
    .map(
      (l) => `
      <tr>
        <td style="font-weight: 600;">${htmlEscape(l.name)}</td>
        <td class="amount">${fmtAmt(l.outstanding)}</td>
        <td class="amount">${fmtPct(l.interestRate)}</td>
        <td class="amount">${fmtAmt(l.emiAmount)}</td>
        <td class="amount">${l.remainingMonths} mo</td>
      </tr>`,
    )
    .join("");

  function strategySection(s: typeof report.avalanche): string {
    const payoffEvents = s.timeline.filter((t) => t.isPayoff);
    const payoffRows = payoffEvents
      .map(
        (e) => `
        <tr>
          <td>${htmlEscape(e.date)}</td>
          <td>${htmlEscape(e.loanName)}</td>
          <td class="amount">${fmtAmt(e.payment)}</td>
        </tr>`,
      )
      .join("");

    return `
      <div class="card">
        <div class="card-title">${htmlEscape(s.name)} Strategy</div>
        <div style="font-size: 10px; color: #64748B; margin-bottom: 10px;">${htmlEscape(s.description)}</div>
        <div class="stats-grid" style="margin-bottom: 10px;">
          <div class="stat-box">
            <div class="stat-label">Total Interest</div>
            <div class="stat-value red">${fmtAmt(s.totalInterestPaid)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Interest Saved</div>
            <div class="stat-value green">${fmtAmt(s.interestSaved)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Debt-Free Date</div>
            <div class="stat-value">${htmlEscape(s.debtFreeDate)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Months Saved</div>
            <div class="stat-value green">${s.monthsSaved}</div>
          </div>
        </div>
        ${payoffRows ? `
          <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px;">Payoff Timeline</div>
          <table class="data-table">
            <thead><tr><th>Date</th><th>Loan</th><th style="text-align: right;">Final Payment</th></tr></thead>
            <tbody>${payoffRows}</tbody>
          </table>
        ` : ""}
      </div>
    `;
  }

  const recommended = report.recommended === "avalanche" ? report.avalanche : report.snowball;

  const body = `
    <div style="padding: 16px 0;">
      ${reportHeaderHtml("Loan Payoff Strategy", `Extra payment: ${fmtAmt(report.inputs.extraMonthlyAmount)}/month`, logoBase64, [
        { label: "Data As Of", value: fmtDate(report.dataAsOf) },
        { label: "Generated", value: today },
      ])}

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Total Outstanding</div>
          <div class="stat-value red">${fmtAmt(report.totalOutstanding)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Monthly EMI</div>
          <div class="stat-value">${fmtAmt(report.totalMonthlyEMI)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Weighted Avg Rate</div>
          <div class="stat-value">${fmtPct(report.weightedAvgRate)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Post Debt-Free Surplus</div>
          <div class="stat-value green">${fmtAmt(report.postDebtFreeMonthlySurplus)}/mo</div>
        </div>
      </div>

      <div class="section-title">Active Loans</div>
      <table class="data-table">
        <thead><tr><th>Loan</th><th style="text-align: right;">Outstanding</th><th style="text-align: right;">Rate</th><th style="text-align: right;">EMI</th><th style="text-align: right;">Remaining</th></tr></thead>
        <tbody>${loanRows}</tbody>
      </table>

      <div class="section-title">Avalanche Strategy</div>
      ${strategySection(report.avalanche)}

      <div class="section-title">Snowball Strategy</div>
      ${strategySection(report.snowball)}

      <div class="section-title">Comparison</div>
      <div class="card">
        <table class="data-table" style="margin-bottom: 0;">
          <thead><tr><th></th><th style="text-align: right;">Avalanche</th><th style="text-align: right;">Snowball</th></tr></thead>
          <tbody>
            <tr><td>Total Interest</td><td class="amount">${fmtAmt(report.avalanche.totalInterestPaid)}</td><td class="amount">${fmtAmt(report.snowball.totalInterestPaid)}</td></tr>
            <tr><td>Duration</td><td class="amount">${report.avalanche.totalMonths} months</td><td class="amount">${report.snowball.totalMonths} months</td></tr>
            <tr><td>Interest Saved</td><td class="amount green">${fmtAmt(report.avalanche.interestSaved)}</td><td class="amount green">${fmtAmt(report.snowball.interestSaved)}</td></tr>
            <tr><td>Debt-Free Date</td><td class="amount">${htmlEscape(report.avalanche.debtFreeDate)}</td><td class="amount">${htmlEscape(report.snowball.debtFreeDate)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="section-title">Recommendation</div>
      <div class="card" style="border-left: 3px solid #0F766E;">
        <div style="font-weight: 700; font-size: 12px; margin-bottom: 4px;">${htmlEscape(recommended.name)} Strategy Recommended</div>
        <div style="font-size: 10px; color: #64748B;">
          ${htmlEscape(recommended.description)}
          ${report.interestDifference > 0 ? ` Saves ${fmtAmt(report.interestDifference)} more in interest vs the alternative.` : ""}
        </div>
      </div>

      ${disclaimerHtml()}
    </div>
  `;

  const html = wrapPage(body, "Loan Payoff Strategy", logoBase64, today);
  return generatePDF(html, `Loan_Payoff_${timestamp()}.pdf`);
}

// ─── Spending Personality PDF ───

export async function exportSpendingPersonalityPDF(
  report: SpendingPersonalityReport,
): Promise<string> {
  const logoBase64 = await getLogoBase64();
  const today = todayFormatted();

  const categoryRows = report.topCategories
    .slice(0, 10)
    .map(
      (c) => `
      <tr>
        <td>${htmlEscape(c.categoryName)}</td>
        <td class="amount">${fmtAmt(c.totalSpent)}</td>
        <td class="amount">${fmtPct(c.percentage)}</td>
        <td style="width: 30%;">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(c.percentage, 100)}%; background: #0F766E;"></div>
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const merchantRows = report.topMerchants
    .slice(0, 10)
    .map(
      (m) => `
      <tr>
        <td>${htmlEscape(m.merchant)}</td>
        <td class="amount">${fmtAmt(m.totalSpent)}</td>
        <td class="amount">${m.transactionCount}</td>
      </tr>`,
    )
    .join("");

  const dayRows = report.dayOfWeekPattern
    .map(
      (d) => `
      <tr>
        <td>${htmlEscape(d.day)}</td>
        <td class="amount">${fmtAmt(d.avgSpend)}</td>
        <td class="amount">${d.transactionCount}</td>
      </tr>`,
    )
    .join("");

  const trendRows = report.monthlyPattern
    .map(
      (m) => `
      <tr>
        <td>${htmlEscape(m.month)}</td>
        <td class="amount">${fmtAmt(m.total)}</td>
      </tr>`,
    )
    .join("");

  const iconToEmoji: Record<string, string> = {
    "calendar-outline": "📅",
    "trending-up-outline": "📈",
    "trending-down-outline": "📉",
    "receipt-outline": "🧾",
    "shield-checkmark-outline": "🛡️",
    "flash-outline": "⚡",
    "restaurant-outline": "🍽️",
    "pie-chart-outline": "📊",
    "hourglass-outline": "⏳",
  };

  const insightRows = report.insights
    .map(
      (ins) => {
        const emoji = iconToEmoji[ins.icon] || "💡";
        const sentimentColor = ins.sentiment === "positive" ? "#22C55E" : ins.sentiment === "warning" ? "#F59E0B" : "#6B7280";
        return `
      <div class="action-item" style="align-items: flex-start;">
        <div style="width: 28px; height: 28px; border-radius: 14px; background: ${sentimentColor}18; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px;">${emoji}</div>
        <div style="flex: 1;">
          <div class="action-title">${htmlEscape(ins.title)}</div>
          <div class="action-desc">${htmlEscape(ins.detail)}</div>
        </div>
      </div>`;
      },
    )
    .join("");

  const traitTags = report.archetype.traits
    .map(
      (t) =>
        `<span style="display: inline-block; background: #0F766E20; color: #0F766E; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; margin: 2px 4px 2px 0;">${htmlEscape(t)}</span>`,
    )
    .join("");

  const body = `
    <div style="padding: 16px 0;">
      ${reportHeaderHtml("Spending Personality Report", "Understand your financial behavior", logoBase64, [
        { label: "Data As Of", value: fmtDate(report.dataAsOf) },
        { label: "Months Analyzed", value: String(report.monthsAnalyzed) },
        { label: "Generated", value: today },
      ])}

      <div class="card" style="text-align: center; margin-bottom: 16px;">
        <div style="font-size: 32px; margin-bottom: 4px;">${htmlEscape(report.archetype.emoji)}</div>
        <div style="font-size: 16px; font-weight: 800; color: #0F766E; margin-bottom: 4px;">${htmlEscape(report.archetype.name)}</div>
        <div style="font-size: 11px; color: #64748B; margin-bottom: 8px;">${htmlEscape(report.archetype.description)}</div>
        <div>${traitTags}</div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Monthly Avg Spend</div>
          <div class="stat-value">${fmtAmt(Math.round(report.monthlyAvg))}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Consistency Score</div>
          <div class="stat-value ${report.consistencyScore >= 70 ? "green" : report.consistencyScore >= 40 ? "amber" : "red"}">${Math.round(report.consistencyScore)}%</div>
        </div>
      </div>

      ${categoryRows ? `
        <div class="section-title">Top Categories</div>
        <table class="data-table">
          <thead><tr><th>Category</th><th style="text-align: right;">Amount</th><th style="text-align: right;">Share</th><th></th></tr></thead>
          <tbody>${categoryRows}</tbody>
        </table>
      ` : ""}

      ${merchantRows ? `
        <div class="section-title">Top Merchants</div>
        <table class="data-table">
          <thead><tr><th>Merchant</th><th style="text-align: right;">Amount</th><th style="text-align: right;">Transactions</th></tr></thead>
          <tbody>${merchantRows}</tbody>
        </table>
      ` : ""}

      ${dayRows ? `
        <div class="section-title">Day-of-Week Pattern</div>
        <table class="data-table">
          <thead><tr><th>Day</th><th style="text-align: right;">Avg Spend</th><th style="text-align: right;">Transactions</th></tr></thead>
          <tbody>${dayRows}</tbody>
        </table>
      ` : ""}

      ${trendRows ? `
        <div class="section-title">Monthly Trend</div>
        <table class="data-table">
          <thead><tr><th>Month</th><th style="text-align: right;">Spend</th></tr></thead>
          <tbody>${trendRows}</tbody>
        </table>
      ` : ""}

      ${report.insights.length > 0 ? `
        <div class="section-title">Behavioral Insights</div>
        ${insightRows}
      ` : ""}

      ${disclaimerHtml()}
    </div>
  `;

  const html = wrapPage(body, "Spending Personality Report", logoBase64, today);
  return generatePDF(html, `Spending_Personality_${timestamp()}.pdf`);
}

// ─── Share ───

export async function sharePDF(fileUri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
    });
  }
}
