/**
 * Sample data for store screenshots — DEMO BUILDS ONLY.
 *
 * A demo build is made with ARTH_DEMO=1 (see app.config.js): it installs as a
 * separate app (com.souravbaid.arth.demo) and sets `extra.demoData`. Normal
 * builds never show the option, and `seedDemoData` refuses to run outside a
 * demo build or on a database that already has transactions.
 *
 * Everything here is fictional: names, banks' last-4 digits, amounts.
 * Data is created through the same services the app uses, so every screen
 * computes it exactly like real data.
 */
import Constants from "expo-constants";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { createTransfer } from "@/services/account-transfer";
import { upsertBudget } from "@/services/budget";
import { getCategories, seedDefaultCategories } from "@/services/category";
import { createExpense } from "@/services/expense-crud";
import { createManualAccount, updateAccountFinancials } from "@/services/financial-account";
import { createEntry, createPerson } from "@/services/hisaab";
import { createLifeMilestone } from "@/services/life-milestone";
import { createLoan } from "@/services/loan-accounts";
import { getPaymentModes, seedDefaultPaymentModes } from "@/services/payment-mode";
import { bumpDataVersion } from "@/services/settings";

export function isDemoBuild(): boolean {
  return Constants.expoConfig?.extra?.demoData === true;
}

const U = DEFAULT_USER_ID;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Deterministic pseudo-random so every demo install looks the same. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Everyday spending: [merchant, category, payment mode, min, max, times per month]
const SPENDS: Array<[string, string, string, number, number, number]> = [
  ["Swiggy", "Food", "UPI", 220, 640, 6],
  ["Zomato", "Food", "Credit Card", 260, 720, 4],
  ["Blue Tokai Coffee", "Food", "UPI", 180, 420, 4],
  ["BigBasket", "Grocery & Supplies", "UPI", 900, 2600, 3],
  ["Zepto", "Grocery & Supplies", "UPI", 250, 900, 4],
  ["Uber", "Travel & Going Out", "UPI", 180, 520, 5],
  ["PVR Cinemas", "Travel & Going Out", "Credit Card", 600, 1100, 1],
  ["Amazon", "Shopping & Gifts", "Credit Card", 700, 3400, 2],
  ["Myntra", "Shopping & Gifts", "Credit Card", 1200, 2800, 1],
  ["Indian Oil", "Car & Vehicles", "Credit Card", 1500, 2600, 2],
  ["Apollo Pharmacy", "Health & Medicine", "UPI", 250, 900, 1],
];

// Monthly fixed costs: [merchant, category, mode, amount, day of month]
const FIXED: Array<[string, string, string, number, number]> = [
  ["House rent", "Rent & Utilities", "Net Banking", 28000, 5],
  ["BESCOM Electricity", "Rent & Utilities", "UPI", 1840, 12],
  ["Airtel Broadband", "Rent & Utilities", "Credit Card", 1179, 9],
  ["Netflix", "Subscriptions", "Credit Card", 649, 14],
  ["Spotify", "Subscriptions", "Credit Card", 119, 18],
  ["Cult.fit", "Health & Medicine", "Credit Card", 1499, 3],
];

const BUDGETS: Record<string, number> = {
  "Rent & Utilities": 32000,
  Food: 9000,
  "Grocery & Supplies": 8000,
  "Travel & Going Out": 5000,
  "Shopping & Gifts": 6000,
  "Car & Vehicles": 5000,
  "Health & Medicine": 3000,
  Subscriptions: 2000,
  EMIs: 15000,
};

export async function seedDemoData(): Promise<void> {
  if (!isDemoBuild()) throw new Error("Sample data is only available in demo builds.");
  const db = getDatabase();
  const existing = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM expenses;");
  if ((existing?.n ?? 0) > 0) throw new Error("This install already has transactions. Use a fresh demo install.");

  await seedDefaultCategories(U);
  await seedDefaultPaymentModes(U);
  const cats = Object.fromEntries((await getCategories(U)).map((c) => [c.name, c.id]));
  const modes = Object.fromEntries((await getPaymentModes(U)).map((m) => [m.name, m.id]));
  const rand = rng(42);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

  // ── Accounts ──
  const savings = await createManualAccount({ userId: U, bankName: "HDFC Bank", accountType: "savings", accountIdentifier: "4821", accountLabel: "Salary account" });
  const savings2 = await createManualAccount({ userId: U, bankName: "SBI", accountType: "savings", accountIdentifier: "1934" });
  const card = await createManualAccount({ userId: U, bankName: "ICICI Bank", accountType: "credit_card", accountIdentifier: "7712" });
  const card2 = await createManualAccount({ userId: U, bankName: "Axis Bank", accountType: "credit_card", accountIdentifier: "3390" });
  const wallet = await createManualAccount({ userId: U, bankName: "Amazon Pay", accountType: "wallet", accountIdentifier: "AMZN" });
  await updateAccountFinancials(card, { credit_limit: 300000 });
  await updateAccountFinancials(card2, { credit_limit: 150000 });

  const accountFor = (mode: string, i: number) =>
    mode === "Credit Card" ? (i % 3 === 0 ? card2 : card) : mode === "Wallet" ? wallet : savings;

  const spend = (date: Date, merchant: string, cat: string, mode: string, amount: number, i: number) =>
    createExpense({
      user_id: U,
      amount,
      merchant_name: merchant,
      description: merchant,
      category_id: cats[cat] ?? cats["Miscellaneous"],
      payment_mode_id: modes[mode],
      account_id: accountFor(mode, i),
      date: iso(date),
    });

  // ── Three months of activity, oldest first ──
  const today = new Date();
  for (let m = 2; m >= 0; m--) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1, 12);
    const lastDay = m === 0 ? today.getDate() : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const on = (day: number) => new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, lastDay), 12);

    await createExpense({
      user_id: U, amount: 142500, nature: "credit", merchant_name: "Acme Technologies",
      description: "Salary", payment_mode_id: modes["Net Banking"], account_id: savings, date: iso(on(1)),
    });
    if (m === 1) {
      await createExpense({
        user_id: U, amount: 4200, nature: "credit", merchant_name: "Amazon",
        description: "Refund: headphones", account_id: card, date: iso(on(22)),
      });
    }

    let i = 0;
    for (const [merchant, cat, mode, amount, day] of FIXED) {
      if (day <= lastDay) await spend(on(day), merchant, cat, mode, amount, i++);
    }
    for (const [merchant, cat, mode, lo, hi, perMonth] of SPENDS) {
      for (let k = 0; k < perMonth; k++) {
        const day = 1 + Math.floor(rand() * lastDay);
        await spend(on(day), merchant, cat, mode, between(lo, hi), i++);
      }
    }

    if (lastDay >= 7) {
      await createTransfer({ userId: U, fromAccountId: savings, toAccountId: savings2, amount: 25000, description: "Monthly savings", date: iso(on(7)) });
    }
    if (lastDay >= 15) {
      await createTransfer({ userId: U, fromAccountId: savings, toAccountId: card, amount: between(14000, 19000), description: "ICICI card bill", date: iso(on(15)) });
      await createTransfer({ userId: U, fromAccountId: savings, toAccountId: card2, amount: between(5000, 8000), description: "Axis card bill", date: iso(on(16)) });
    }
  }

  // ── Budgets for the current month ──
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  for (const [cat, amount] of Object.entries(BUDGETS)) {
    if (cats[cat]) await upsertBudget({ user_id: U, category_id: cats[cat], month, amount });
  }

  // ── Loan ──
  const loanStart = daysAgo(400);
  await createLoan({
    user_id: U, bank_name: "HDFC Bank", account_identifier: "5560", loan_type: "auto",
    principal_sanctioned: 650000, principal_disbursed: 650000,
    disbursement_date: iso(loanStart), emi_start_date: iso(new Date(loanStart.getFullYear(), loanStart.getMonth() + 1, 10, 12)),
    emi_day_of_month: 10, interest_rate_pa: 9.1, interest_type: "fixed", interest_method: "reducing",
    tenure_months: 60, account_label: "Car loan",
  });

  // ── Hisaab (family ledger) ──
  const priya = await createPerson({ owner_user_id: U, name: "Priya" });
  const rohan = await createPerson({ owner_user_id: U, name: "Rohan" });
  const ananya = await createPerson({ owner_user_id: U, name: "Ananya" });
  await createEntry({ hisaab_person_id: priya, amount: 2400, description: "Dinner at Toit", date: iso(daysAgo(9)), type: "debit" });
  await createEntry({ hisaab_person_id: priya, amount: 1150, description: "Concert tickets", date: iso(daysAgo(24)), type: "debit" });
  await createEntry({ hisaab_person_id: rohan, amount: 5000, description: "Borrowed for trip", date: iso(daysAgo(18)), type: "credit" });
  await createEntry({ hisaab_person_id: ananya, amount: 3200, description: "Goa stay share", date: iso(daysAgo(40)), type: "debit" });
  await createEntry({ hisaab_person_id: ananya, amount: 3200, description: "Paid back", date: iso(daysAgo(30)), type: "settlement" });

  // ── Goals ──
  const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), 1, 12);
  await createLifeMilestone({ user_id: U, name: "Home down payment", target_amount: 1500000, target_date: iso(new Date(today.getFullYear() + 3, 2, 31, 12)), monthly_contribution_planned: 30000 });
  await createLifeMilestone({ user_id: U, name: "Europe trip", target_amount: 350000, target_date: iso(nextYear), monthly_contribution_planned: 15000 });

  bumpDataVersion();
}
