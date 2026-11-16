# Fixed deposit improvements: proposal (4.48.x feedback, 16 Nov 2026)

Status: **approved 16 Nov 2026 and implemented** (uncommitted). Defaults taken for the open questions: half-down rounding kept; upcoming FDs without a manual correction recomputed (on every app start, so restored backups are fixed too); renewal keeps the old rate and the edit screen says so.

This covers the six FD/form points (4–9) and the ₹1 maturity gap. Each point lists what happens today, the change, and the files it touches. One migration is needed (point 4). Everything else is UI or maths.

---

## A. The ₹1 maturity difference (do this first; the other points build on it)

### What Arth does today
`services/investment-engine.ts` → `computeFDInterestRaw`:
- Term in years = days ÷ **365.25**.
- Compound: `P × (1 + r/n)^(n × years)`. The exponent is fractional: a 400-day FD gets "4.38 quarters".
- Simple: `P × r × years`.
- Interest is rounded to the rupee with "half rounds down" (your earlier request).
- If you pick Compound, it compounds even when the term is under 6 months.

### What Indian banks do
SBI, HDFC and ICICI terms and calculators, and the RBI/IBA rule for an incomplete last quarter, all point to the same method:
1. **Under 6 months:** simple interest, `P × r × days ÷ 365`, paid at maturity.
2. **6 months or more:** compound once per **completed calendar quarter**, counted from the start date (15 Apr → 15 Jul → 15 Oct …).
3. **Leftover days** after the last full quarter (the "broken period") earn simple interest on the compounded amount: `A × r × days ÷ 365`.
4. The year is **365 days**, even in leap years (SBI/IBA; a few banks use 366 in leap years).
5. The **final** interest is rounded to the rupee. Rounding each quarter to paise makes no rupee-level difference (checked).

### Reproducing the gap
Arth's figure (today) against the bank method. "Bank" means quarters + broken days at 365.

| Deposit | Rate | Term | Arth today | Bank | Gap |
|---|---|---|---|---|---|
| ₹10,000 | 7% | 1 year (365 d) | 10,718 | 10,719 | **−₹1** |
| ₹25,000 | 7% | 366 d | 26,800 | 26,802 | −₹2 |
| ₹50,000 | 6.8% | 1 year | 53,485 | 53,488 | −₹3 |
| ₹1,00,000 | 7% | 1 year | 1,07,181 | 1,07,186 | −₹5 |
| ₹1,00,000 | 7% | 400 d | 1,07,896 | 1,07,905 | −₹9 |
| ₹1,00,000 | 7.1% | 2 years (731 d) | 1,15,125 | 1,15,114 | +₹11 |
| ₹2,00,000 | 7.1% | 1 y 6 m 17 d | 2,22,917 | 2,23,003 | −₹86 |

**Cause.** The 365.25 divisor makes a 1-year FD count as 0.9993 of a year, so Arth is always a little short on exact-year terms. On a small FD that's ₹1; on larger FDs or broken-period terms it's more, because fractional compounding is not the bank's quarters-plus-simple-days method. Across 675 realistic test FDs, Arth matched the bank method to within ₹1 in only 12% of cases.

### The change
Rewrite `computeFDInterestRaw` to the bank method above (steps 1–4). Keep `computeFDInterest` / `computeFDMaturityValue` / `generateFDSchedule` signatures, so every caller (add FD, Mark as FD, Edit FD, home, projections) is fixed at once.
- Compounding frequency still applies (monthly = 1-month periods, annually = 12-month periods). Quarterly stays the default.
- "Simple" stays available for payout-style FDs.
- Keep half-down rounding (your earlier rule) unless you say otherwise. Banks round 50 paise up, so this only matters when interest ends in exactly ₹0.50.

**Files:** `services/investment-engine.ts`; `__tests__/unit/investment-engine.test.ts` (rewrite expected values from the table above; add <6-month, broken-period, month-end-start (31 Jan) and leap-year cases).

**Existing FDs:** stored schedules keep their old interest figure until edited. Option: a one-time recompute of every still-scheduled FD that has **no** manual correction. See Question 2.

**Residual:** a bank that uses 366 days in leap years, or deducts TDS, can still differ. Point 7 covers that.

---

## 4. Renewal setting when creating an FD

### Today
Every FD is treated as "no auto-renew". On the maturity date, `materialiseMaturedInvestments` queues one "FD maturity" credit (principal + interest, or your corrected amount) on the funding account. When that credit, or the bank's own SMS credit matched by `settleMaturedFDs`, is approved, `finaliseScheduleEntry` marks the FD matured, records the bucket withdrawal and closes the FD account. The `auto_credit_on_maturity` column exists but is always 1 and never read.

### The change
A **Renewal** choice on the FD form (default: *No auto-renew*):

| Setting | At maturity, Arth… | FD afterwards |
|---|---|---|
| **No auto-renew** | Unchanged: queues the full payout on the funding account; the FD closes when it's approved. | Closed |
| **Renew principal only** | Queues only the **interest** as a credit to the funding account ("HDFC FD interest"), for you to review. | Stays open. Same principal; new start = old maturity date; new maturity = start + same term. |
| **Renew principal + interest** | Credits nothing to your bank. Records the interest as a credit **inside the FD account**, so its balance grows to the maturity amount. | Stays open. Principal = old maturity amount; new term as above. |

Details:
- **Term on renewal** = the original term in years/months/days (point 9 helper), so a 1-year FD renews for 1 year.
- **Rate on renewal:** banks renew at their rate on that day, which Arth can't know. Arth keeps the old rate and shows "Renewed on 13 Nov 2027. Check the new rate", which opens Edit. Correcting the rate regenerates only the new term's schedule.
- **TDS:** if the bank renews with interest net of TDS, use the maturity-amount correction (point 7) or edit the renewed principal.
- **Bucket link:** stays linked across renewals. The withdrawal is recorded only when the FD finally closes.
- **You closed it at the bank instead:** the existing "Close FD with this credit" flow (`closeFdWithCredit` → `linkClosureCreditToFD`) still works on a renewed FD. Mark the payout credit and the FD closes. For *principal only*, `settleMaturedFDs` matches an interest-only credit from the bank's SMS instead of a full payout.
- Renewal can be changed later in **Edit Fixed Deposit** until the maturity date passes.
- Renewal mode lives on the product row. Each renewal re-dates the product, and the old schedule entry stays `materialised` as history, so renewed terms show as events 1, 2, 3…

### Files
- `database/migrations/094_fd_renewal_mode.ts` (new): `ALTER TABLE investment_products ADD COLUMN renewal_mode TEXT NOT NULL DEFAULT 'none'` with a `PRAGMA table_info` guard. Values: `none` / `principal` / `principal_interest`.
- `database/migrations/index.ts`: register it.
- `database/TABLE_SCHEMAS.ts`: add `renewal_mode` to `investment_products`. The table is already in `BACKUP_TABLES`; no cascade changes needed (the column lives on an existing row).
- `services/investment-accounts.ts`: `InvestmentProduct` type, `createFDAccount` / `createFDAccountShell` / `updateFDDetails` inputs, a new `renewFD()` called from `materialiseMaturedInvestments` / `settleMaturedFDs` for renewing FDs.
- `services/investment-engine.ts`: `fdTermBetween()` / `addFDTerm()` (shared with point 9).
- UI: the FD form (point 8), `CompleteFDDetailsSheet.tsx`, `MarkAsFDSheet.tsx`.
- Tests: renewal for both modes (schedule rolled, credit queued to the right account, FD stays open, bucket untouched), and closing a renewed FD with a credit. Update mocks with `renewal_mode`.

---

## 5. Bank picker on the FD form

**Today:** a free-text "Bank name" box (`app/investments/add-fd.tsx`, `MarkAsFDSheet.tsx`).

**Change:** chips listing the banks where you already have accounts: distinct `bank_name` from active savings, credit card, loan and FD accounts (no wallets or brokers), most-used first, plus **Other**, which reveals the free-text box. Picking the "Funded from" account pre-selects its bank if you haven't chosen one. On *Mark as FD* the bank from the SMS is pre-selected as today.

**Files:** new `components/account/BankPicker.tsx`; a `getUserBankNames()` helper in `services/financial-account.ts`; used in the FD form and `MarkAsFDSheet.tsx`.

---

## 6. Pension accounts: "Account name" instead of "Bank name"

**Today:** in `app/settings/account-add.tsx`, Pension shares the bank fields ("Bank Name", "e.g., HDFC Bank…"), and the error says "Bank name is required."

**Change:** for Pension, label **Account name**, placeholder "e.g., EPFO, NPS", error "Account name is required." Same `bank_name` column, so no data change; EPFO SMS matching is unaffected. The digits field becomes "Last 4 digits of UAN / PRAN".

**Files:** `app/settings/account-add.tsx` only.

---

## 7. Correct the calculated figures while creating

**Today:** the Add FD screen shows "Projected maturity value" read-only. The correction box ("Corrected maturity amount", stored as `maturity_amount_override`) exists only in Edit and in Mark as FD.

**Change:** the projected card shows **Maturity amount** and **Interest** (= maturity − principal), with a "Bank's figure differs? Correct it" link that turns the maturity amount into an editable box, pre-filled with Arth's figure. Changing either box updates the other. On save, a value that differs from Arth's is stored via `setFDMaturityOverride`, exactly as Edit does today, so all maturity matching already honours it. A "Use Arth's figure" link clears it.

**Files:** the FD form (point 8); `createFDAccount` gains an optional `maturity_amount_override` so the FD and its correction save together.

---

## 8. Fixed deposit on Add account: same page like the other types

**Today:** in `app/settings/account-add.tsx`, Fixed deposit is a styled-alike chip that `router.push`es to `/investments/add-fd`. Every other chip shows its form below.

**Change:** move the Add-FD form body into a shared component, `components/account/FDForm.tsx`, with its own Save button and an `onSaved` callback. Then:
- `account-add.tsx`: Fixed deposit is a real chip; choosing it renders `<FDForm>` below the type picker and hides the "Add account" button. Also accepts `presetType=fd`.
- `app/investments/add-fd.tsx`: becomes a thin wrapper around `<FDForm>`, so Investments → Add FD looks the same as before.

**Files:** new `components/account/FDForm.tsx`; `app/investments/add-fd.tsx`; `app/settings/account-add.tsx`.

---

## 9. Term as years / months / days, or a maturity date

**Today:** only a maturity date picker.

**Change:** "Matures" gets a two-way toggle, **Date | Term**. Term = three small boxes (Years, Months, Days); any combination is fine (e.g. 0 / 0 / 400, or 1 / 6 / 0). Whichever you fill, the other is worked out and shown underneath ("Matures on 13 May 2028" / "Term: 1 year 6 months"). Banks' convention: months are added first with month-end clamping (31 Jan + 1 month = 28/29 Feb), then days.

**Files:** `addFDTerm` / `fdTermBetween` in `services/investment-engine.ts` (pure, unit tested); new `components/account/FDTermInput.tsx`; used in `FDForm`, `CompleteFDDetailsSheet.tsx` and `MarkAsFDSheet.tsx`.

---

## Database Changes Checklist (CLAUDE.md)
1. Migration `094_fd_renewal_mode.ts` with a `PRAGMA table_info` guard. ✔ planned
2. Registered in `migrations/index.ts`. ✔
3. `renewal_mode` added to `TABLE_SCHEMAS.investment_products`. ✔
4. `BACKUP_TABLES`: already contains `investment_products`. ✔
5. Cascades: none needed (column on an existing row; renewal creates no new rows besides schedule entries and credits, which already cascade). ✔
6. Test mocks of `InvestmentProduct` updated. ✔
7. SQL that selects explicit product columns (`getInvestmentProduct`, `batchInvestmentProducts`, `insertFDProductAndSchedule`, the settle/materialise joins) updated. ✔
8. No new MMKV keys, unless Question 2's recompute is approved (then one registry entry, device-only). ✔

**Version check before bumping:** `gh release list` first; other sessions share the repo.

---

## Questions for you
1. **Rounding:** keep "half rounds down" for FD interest, or switch to the banks' normal rounding (50 paise rounds up)?
2. **Existing FDs:** recompute the figures of FDs that haven't matured and that you haven't corrected by hand, using the new maths? (Recommended. Corrected ones are left alone.)
3. **Renewal rate:** keep the old rate on renewal and nudge you to check it (proposed), or ask for the new rate before renewing?
4. **A real example helps:** one of your FDs' amount, rate, start and maturity dates and the bank's maturity figure would confirm the method for your bank. Leap-year handling and TDS are the remaining variables.

---

### Sources consulted (bank FD method)
- [RBI master circular on interest rates on rupee deposits](https://website.rbi.org.in/web/rbi/-/notifications/master-circular-on-interest-rates-on-rupee-deposits-1927): incomplete terminal quarter, 365-day basis, some banks use 366 in leap years
- [RBI Master Directions](https://rbi.org.in/ScriptS/BS_ViewMasDirections.aspx?id=13003)
- [Upstox: how SBI calculates FD interest](https://upstox.com/news/personal-finance/investing/sbi-fixed-deposit-calculation-how-sbi-calculates-interest-on-f-ds-for-senior-citizens-others/article-149981)
- [ClearTax SBI FD calculator](https://cleartax.in/s/sbi-fd-calculator)
- [BankBazaar SBI FD calculator](https://www.bankbazaar.com/fixed-deposit/sbi-fd-calculator.html)
