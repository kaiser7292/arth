import fs from "fs";

/**
 * A credit reclassified as a transfer is represented by the transfer row. The credit row stays in
 * `expenses` with `reclassified_as_transfer = 1` rather than being deleted, so anything that
 * counts or lists approved credits must exclude it — otherwise the amount is counted twice.
 *
 * That filter had been applied to every `nature = 'realized'` query and to only ONE of the three
 * `nature = 'credit'` totals. The result: approving a credit and then marking it as a transfer put
 * two rows in the account ledger and double-counted the amount in the ledger summary, the home
 * hero cards and the balance sheet.
 *
 * The realized/credit asymmetry is the tell, so this test enforces symmetry rather than trying to
 * enumerate call sites: in the files that compute balances or feed the ledger, every query over
 * approved credits filters the flag.
 *
 * `getAccountLatestStaleCheckDates` is deliberately not in scope. It takes MAX(date) to work out
 * when an account was last active, and a reclassified credit's date is a real date either way.
 */
const BALANCE_FILES = [
  "services/account-balance.ts",
  "services/account-credit.ts",
  "services/balance-sheet.ts",
  "services/budget.ts",
  "services/simulator.ts",
];

const FLAG = "reclassified_as_transfer";

/** Pull every backtick-quoted SQL string that reads from `expenses`. */
function expenseQueries(src: string): { line: number; sql: string }[] {
  const out: { line: number; sql: string }[] = [];
  const re = /`([^`]*FROM expenses[^`]*)`/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ line: src.slice(0, m.index).split(/\r?\n/).length, sql: m[1] });
  }
  return out;
}

describe("reclassified credits", () => {
  it("are excluded from every approved-credit balance and ledger query", () => {
    const offenders: string[] = [];
    for (const file of BALANCE_FILES) {
      const src = fs.readFileSync(file, "utf8");
      for (const { line, sql } of expenseQueries(src)) {
        const isApprovedCredit =
          sql.includes("nature = 'credit'") && sql.includes("status = 'approved'");
        if (isApprovedCredit && !sql.includes(FLAG)) {
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("are excluded from every approved-debit query in the same files", () => {
    // The debit side was already right. Asserting it too is what keeps the two in step: a future
    // query added for one nature and not the other fails here rather than in someone's ledger.
    const offenders: string[] = [];
    for (const file of BALANCE_FILES) {
      const src = fs.readFileSync(file, "utf8");
      for (const { line, sql } of expenseQueries(src)) {
        const isApprovedDebit =
          sql.includes("nature = 'realized'") && sql.includes("status = 'approved'");
        if (isApprovedDebit && !sql.includes(FLAG)) {
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
