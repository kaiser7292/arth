import { DatabaseSync } from "node:sqlite";

/**
 * Money events end to end — real schema (every migration on a real SQLite
 * engine), real parser, real SMS-to-expense path:
 *   - self-transfers pair into ONE transfer, whichever side arrives first
 *   - a transfer to your own name with no other side is flagged for review
 *   - FD deposits are flagged, FD closures close the matching FD
 *   - undoing a paired transfer restores both rows
 * SMS bodies are real formats with names and account digits replaced.
 */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

const mockStore = new Map<string, string | number | boolean>();
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: string | number | boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { createManualAccount } from "../../services/financial-account";
import { createFDAccountShell } from "../../services/investment-accounts";
import { findDepositDebitForClosure, closeFdWithCredit, recheckSelfTransfers } from "../../services/money-events";
import { setSelfNames, pickSelfNameSuggestion, looksLikePersonName, getSelfNameSuggestion } from "../../services/self-names";
import { undoTransfer } from "../../services/account-transfer";
import { parseSmsBatch } from "../../services/sms/sms-parser";
import { createExpenseFromSms } from "../../services/sms/sms-to-expense";

let U = "";
let HDFC = "";
let SBI = "";
let smsSeq = 0;

async function receive(address: string, body: string): Promise<string | null> {
  smsSeq++;
  const res = await parseSmsBatch(U, [{ _id: `sms-${smsSeq}`, address, body, date: Date.UTC(2026, 8, 1) + smsSeq } as never]);
  const item = res.items[0];
  if (!item) throw new Error(`Not parsed: ${body}`);
  const out = await createExpenseFromSms(U, item.pendingSmsId, item.parsed, item.rawBody, item.smsDate);
  return out.expenseId;
}

const row = (id: string) => mockDb.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as Record<string, unknown>;
const transfers = () =>
  mockDb.prepare(`SELECT * FROM account_transfers WHERE deleted_at IS NULL`).all() as Record<string, unknown>[];

const HDFC_IMPS_30K =
  "IMPS INR 30,000.00\nsent from HDFC Bank A/c XX4417 on 03-09-26\nTo A/c xxxxxxxxxx8812\nRef-624633402819\nNot you?Call 18002586161/SMS BLOCK OB to 7308080808";
const SBI_CREDIT_30K =
  "Your A/C XXXXX798812 Credited INR 30,000.00 on 03/09/26 -Deposit by transfer from Mr. RAHULVERMA. Avl Bal INR 62,305.01-SBI";
const SBI_DEBIT_TO_SELF =
  "Your A/C XXXXX798812 Debited INR 50,000.00 on 11/09/26 -Transferred to Mr. RAHULVERMA. Avl Balance INR 20,326.76-SBI";
const SBI_TD_CLOSURE =
  "Dear Customer, Your A/C XXXXX798812 Credited. INR 50,029.00 on 15/09/26 on account of Closure of TD A/c XXXXX031705.-SBI";
const HDFC_FD_OPEN =
  "UPDATE: INR 20,000.00 debited from HDFC Bank XX4417 on 03-SEP-26. Info: FD through MOBILE-XXXXXXXXXX5678:RAHUL VERMA. Avl bal:INR 1,50,000.00";

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  smsSeq = 0;
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  HDFC = await createManualAccount({ userId: U, bankName: "HDFC Bank", accountType: "savings", accountIdentifier: "4417" });
  SBI = await createManualAccount({ userId: U, bankName: "SBI", accountType: "savings", accountIdentifier: "8812" });
  setSelfNames(["Rahul Verma"]);
});

describe("self-transfer pairing", () => {
  it("debit first, then credit → one transfer, both rows reclassified", async () => {
    const debitId = (await receive("VM-HDFCBK", HDFC_IMPS_30K))!;
    expect(row(debitId).money_event).toBe("self_transfer"); // names an own account, other side not in yet
    const creditId = (await receive("VM-SBIINB", SBI_CREDIT_30K))!;

    const t = transfers();
    expect(t).toHaveLength(1);
    expect(t[0].from_account_id).toBe(HDFC);
    expect(t[0].to_account_id).toBe(SBI);
    expect(t[0].amount).toBe(30000);
    for (const id of [debitId, creditId]) {
      expect(row(id).reclassified_as_transfer).toBe(1);
      expect(row(id).linked_transfer_id).toBe(t[0].id);
      expect(row(id).money_event).toBeNull();
    }
    expect(row(creditId).status).toBe("approved");
  });

  it("credit first, then debit → same single transfer", async () => {
    const creditId = (await receive("VM-SBIINB", SBI_CREDIT_30K))!;
    expect(row(creditId).money_event).toBe("self_transfer"); // from your own name, debit not in yet
    const debitId = (await receive("VM-HDFCBK", HDFC_IMPS_30K))!;

    const t = transfers();
    expect(t).toHaveLength(1);
    expect(row(debitId).reclassified_as_transfer).toBe(1);
    expect(row(creditId).reclassified_as_transfer).toBe(1);
  });

  it("undoing the transfer restores both rows", async () => {
    const debitId = (await receive("VM-HDFCBK", HDFC_IMPS_30K))!;
    const creditId = (await receive("VM-SBIINB", SBI_CREDIT_30K))!;
    await undoTransfer(transfers()[0].id as string);
    expect(transfers()).toHaveLength(0);
    expect(row(debitId).reclassified_as_transfer).toBe(0);
    expect(row(creditId).reclassified_as_transfer).toBe(0);
  });

  it("a transfer to your own name with no other side is flagged, not paired", async () => {
    const id = (await receive("VM-SBIINB", SBI_DEBIT_TO_SELF))!;
    expect(row(id).money_event).toBe("self_transfer");
    expect(row(id).reclassified_as_transfer ?? 0).toBe(0);
    expect(transfers()).toHaveLength(0);
  });

  it("without a saved name, a plain transfer credit is left alone", async () => {
    setSelfNames([]);
    const id = (await receive("VM-SBIINB", SBI_CREDIT_30K))!;
    expect(row(id).money_event).toBeNull();
  });
});

describe("FD events", () => {
  it("an FD-funding debit is flagged fd_open and not treated as a transfer", async () => {
    const id = (await receive("VM-HDFCBK", HDFC_FD_OPEN))!;
    expect(row(id).money_event).toBe("fd_open");
    expect(transfers()).toHaveLength(0);
  });

  it("a closure naming the FD's number closes that FD", async () => {
    const fdId = await createFDAccountShell({
      user_id: U,
      bank_name: "SBI",
      account_identifier: "031705",
      principal: 50000,
      start_date: "2026-09-11",
      source_account_id: SBI,
    });
    const creditId = (await receive("VM-SBIINB", SBI_TD_CLOSURE))!;

    expect(row(creditId).status).toBe("approved");
    expect(row(creditId).money_event).toBeNull();
    const fa = mockDb.prepare(`SELECT closed_at FROM financial_accounts WHERE id = ?`).get(fdId) as { closed_at: string | null };
    expect(fa.closed_at).not.toBeNull();
    const se = mockDb
      .prepare(`SELECT principal_component, interest_component, status FROM investment_schedule_entries WHERE linked_expense_id = ?`)
      .get(creditId) as Record<string, unknown>;
    expect(se.principal_component).toBe(50000);
    expect(se.interest_component).toBe(29);
    expect(se.status).toBe("materialised");
  });

  it("an unmatched closure is flagged; its deposit debit can be found for 'Record this FD'", async () => {
    const debitId = (await receive("VM-SBIINB", SBI_DEBIT_TO_SELF))!;
    const creditId = (await receive("VM-SBIINB", SBI_TD_CLOSURE))!;
    expect(row(creditId).money_event).toBe("fd_closure");

    const deposit = await findDepositDebitForClosure(creditId);
    expect(deposit?.id).toBe(debitId);
  });

  it("closing an FD from the review card approves the credit and closes the FD", async () => {
    const creditId = (await receive("VM-SBIINB", SBI_TD_CLOSURE))!;
    const fdId = await createFDAccountShell({
      user_id: U,
      bank_name: "SBI",
      account_identifier: "9999",
      principal: 50000,
      start_date: "2026-09-11",
      source_account_id: SBI,
    });
    await closeFdWithCredit(fdId, creditId);
    expect(row(creditId).status).toBe("approved");
    expect(row(creditId).money_event).toBeNull();
    const fa = mockDb.prepare(`SELECT closed_at FROM financial_accounts WHERE id = ?`).get(fdId) as { closed_at: string | null };
    expect(fa.closed_at).not.toBeNull();
  });
});

describe("your name in bank messages", () => {
  it("suggests the most frequent person-like name, grouping bank spellings", () => {
    const bodies = [SBI_CREDIT_30K, SBI_DEBIT_TO_SELF, HDFC_FD_OPEN, SBI_CREDIT_30K];
    const s = pickSelfNameSuggestion(bodies, [], []);
    expect(s?.count).toBe(4);
    expect(["RAHULVERMA", "RAHUL VERMA"]).toContain(s?.name);
  });

  it("doesn't suggest saved, dismissed, rare or business names", () => {
    const bodies = [SBI_CREDIT_30K, SBI_DEBIT_TO_SELF, SBI_CREDIT_30K];
    expect(pickSelfNameSuggestion(bodies, ["Rahul Verma"], [])).toBeNull();
    expect(pickSelfNameSuggestion(bodies, [], ["RAHULVERMA"])).toBeNull();
    expect(pickSelfNameSuggestion(bodies.slice(0, 2), [], [])).toBeNull();
    expect(looksLikePersonName("ACME TECHNOLOGIES PVT LTD")).toBe(false);
    expect(looksLikePersonName("RAHUL VERMA")).toBe(true);
  });

  it("reads suggestions from the app's own SMS log", async () => {
    setSelfNames([]);
    for (let i = 0; i < 3; i++) await receive("VM-SBIINB", SBI_DEBIT_TO_SELF.replace("50,000.00", `${5000 + i}.00`));
    const s = await getSelfNameSuggestion(U);
    expect(s?.name).toBe("RAHULVERMA");
  });

  it("confirming a name re-checks the review queue", async () => {
    setSelfNames([]);
    const id = (await receive("VM-SBIINB", SBI_DEBIT_TO_SELF))!;
    expect(row(id).money_event).toBeNull();
    setSelfNames(["Rahul Verma"]);
    expect(await recheckSelfTransfers(U)).toBe(1);
    expect(row(id).money_event).toBe("self_transfer");
  });
});

describe("SIPs", () => {
  it("a NACH debit to a mutual fund is flagged sip; Netflix isn't", async () => {
    const sip = (await receive("VM-HDFCBK", "NACH debit of Rs.5000.00 from your HDFC Bank A/c XX4417 on 05-09-26 towards PARAG PARIKH MUTUAL FUND."))!;
    const netflix = (await receive("VM-HDFCBK", "NACH debit of Rs.199.00 from your HDFC Bank A/c XX4417 on 06-09-26 towards NETFLIX."))!;
    expect(row(sip).money_event).toBe("sip");
    expect(row(netflix).money_event).toBeNull();
  });
});

describe("credit card part payment", () => {
  it("a payment smaller than the bill leaves the rest due", async () => {
    const cc = await createManualAccount({ userId: U, bankName: "HDFC Bank", accountType: "credit_card", accountIdentifier: "7731" });
    mockDb
      .prepare(
        `INSERT INTO expenses (id, user_id, amount, currency, description, account_id, date, due_date, nature, forecast_type, source, status)
         VALUES ('bill', ?, 42500, 'INR', 'HDFC credit card bill', ?, '2026-09-25', '2026-10-15', 'forecast', 'repayment', 'sms_auto', 'pending_review')`,
      )
      .run(U, cc);
    await receive("VM-HDFCBK", "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 30000.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 7731 ON 8-10-2026.");
    expect(row("bill").amount).toBe(12500);
    expect(row("bill").description).toBe("HDFC credit card bill · ₹12,500 still due");

    // Paying the rest matches the reduced bill like any full payment.
    await receive("VM-HDFCBK", "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 12500.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 7731 ON 10-10-2026.");
    const credit = mockDb
      .prepare(`SELECT matched_forecast_id FROM expenses WHERE nature = 'credit' AND amount = 12500`)
      .get() as { matched_forecast_id: string | null };
    expect(credit.matched_forecast_id).toBe("bill");
  });
});

describe("switching a manual entry between spent and received", () => {
  it("expense → credit drops spending fields and sets the type; back again clears it", async () => {
    const { createExpense, changeTransactionNature } = await import("../../services/expense-crud");
    const id = await createExpense({ user_id: U, amount: 500, date: "2026-09-10", account_id: HDFC, is_right_spend: 1 });
    await changeTransactionNature(id, "credit", "gift");
    expect(row(id)).toMatchObject({ nature: "credit", credit_kind: "gift", category_id: null, is_right_spend: null });
    await changeTransactionNature(id, "realized");
    expect(row(id)).toMatchObject({ nature: "realized", credit_kind: null });
  });

  it("refuses bank-detected rows", async () => {
    const { changeTransactionNature } = await import("../../services/expense-crud");
    const id = (await receive("VM-SBIINB", SBI_DEBIT_TO_SELF))!;
    await expect(changeTransactionNature(id, "credit")).rejects.toThrow(/Bank-detected/);
  });
});
