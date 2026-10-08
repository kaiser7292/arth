import { useState, useEffect, useMemo, useCallback, useRef } from "react";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getRealizedGainsForTaxYear, toTaxInputs, type WithdrawalGain } from "@/services/realized-gains";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { View, ScrollView, Pressable, KeyboardAvoidingView, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  getEpfMonthlyCeilingLabel,
  getProfessionalTax,
  grossUpBankReceipts,
  type BusinessScheme,
} from "@/services/tax-engine";
import {
  getSalaryProfileByFY,
  createSalaryProfile,
  updateSalaryProfile,
} from "@/services/salary-profile";
import type { SalaryProfile } from "@/services/salary-profile";
import {
  computeIncomeProfile,
  deriveDirectBaseMonthly,
  type IncomeKind,
  type IncomeProfileNumbers,
} from "@/services/income-calculation";
import { getBusinessReceiptsForFY, parseReceiptAccountIds } from "@/services/business-receipts";
import { getActiveAccounts } from "@/services/financial-account";
import { deriveYearlyPlan } from "@/services/yearly-plan";
import { getCurrentFY, getFYLabel, getFYRange } from "@/utils/fiscal-year";
import { todayIso } from "@/utils/date";
import { getFYStartMonth } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";
import { formatDate } from "@/utils/date";
import { Toggle, StatePicker } from "@/components/goals";
import { SalaryInputForm, type MonthlyOverrides } from "@/components/goals/SalaryInputForm";
import { OldRegimeDeductions, AnnualDeductions, AdditionalIncome } from "@/components/goals/DeductionsSection";
import { TaxBreakdown } from "@/components/goals/TaxBreakdown";
import { MonthlyInHandHero, SalarySummary, SalaryFooter } from "@/components/goals/SalarySummary";
import {
  AdvanceTaxCard,
  BusinessInputs,
  BusinessResults,
  InlineNote,
  ReceiptsTracker,
  type BusinessInputsProps,
  type ReceiptAccountOption,
} from "@/components/goals/BusinessIncomeSection";
import { OtherIncomeSection } from "@/components/goals/OtherIncomeSection";

import { useTheme } from "@/hooks/use-theme";

/** Account types that can receive client payments. */
const RECEIPT_ACCOUNT_TYPES = new Set(["savings", "bank", "wallet"]);

/** Don't project a full year from less than this share of it. */
const MIN_FRACTION_FOR_PROJECTION = 0.08;

const num = (v: string) => parseFloat(v) || 0;

// ─── Main Screen ──────────────────────────────────────────

export default function SalaryCalculatorScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const { planId, fy } = useLocalSearchParams<{ planId?: string; fy?: string }>();
  const startMonth = getFYStartMonth();
  const initialFY = fy ?? String(getCurrentFY(startMonth));
  const [selectedFY, setSelectedFY] = useState(initialFY);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);
  const selectedFYNum = parseInt(selectedFY, 10);
  const fyLabel = getFYLabel(selectedFYNum, startMonth);

  // ─── Mode State ──────────────────────────────────────
  const [incomeType, setIncomeType] = useState<"salaried" | "business">("salaried");
  const [inputMode, setInputMode] = useState<"ctc" | "direct">("ctc");
  const [saving, setSaving] = useState(false);
  const [loadingFY, setLoadingFY] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [existingProfile, setExistingProfile] = useState<SalaryProfile | null>(
    null,
  );
  const [prevYearProfile, setPrevYearProfile] = useState<SalaryProfile | null>(null);
  const [showCopyPrompt, setShowCopyPrompt] = useState(false);
  const [showHikeInput, setShowHikeInput] = useState(false);
  const [hikePercent, setHikePercent] = useState("");

  // ─── CTC Mode State ─────────────────────────────────
  const [ctc, setCtc] = useState("");
  const [basicPct, setBasicPct] = useState("40");
  const [hraPct, setHraPct] = useState("50");
  const [isMetro, setIsMetro] = useState("yes");
  const [epfMode, setEpfMode] = useState<"full_basic" | "restricted">(
    "restricted",
  );
  const [epfInCTC, setEpfInCTC] = useState("yes");
  const [gratuityInCTC, setGratuityInCTC] = useState("yes");
  const [vpfMonthly, setVpfMonthly] = useState("0");
  const [state, setState] = useState<string | null>(null);

  // ─── Manual CTC Breakdown (v16.0.9) ─────────────────
  const [ctcMode, setCtcMode] = useState<"percentage" | "manual">("percentage");
  const [manualBasic, setManualBasic] = useState("0");
  const [manualHra, setManualHra] = useState("0");
  const [manualSpecial, setManualSpecial] = useState("0");
  const [manualEmployerEPF, setManualEmployerEPF] = useState("0");
  const [manualGratuity, setManualGratuity] = useState("0");

  // Old regime deductions
  const [deductions80C, setDeductions80C] = useState("0");
  const [deductions80D, setDeductions80D] = useState("0");
  const [hraExemption, setHraExemption] = useState("0");
  const [homeLoan, setHomeLoan] = useState("0");
  const [otherDeductions, setOtherDeductions] = useState("0");

  // ─── Direct Mode State ───────────────────────────────
  const [directMonthly, setDirectMonthly] = useState("");
  const [monthlyOverrides, setMonthlyOverrides] = useState<MonthlyOverrides>({});

  // ─── Manual Correction (CTC mode) ──────────────────
  const [manualInHand, setManualInHand] = useState("");

  // ─── Business / Freelance (primary, or side business when salaried) ──
  const [businessScheme, setBusinessScheme] = useState<BusinessScheme>("presumptive_profession");
  const [businessReceipts, setBusinessReceipts] = useState("");
  const [businessDigitalPct, setBusinessDigitalPct] = useState("100");
  const [businessExpenses, setBusinessExpenses] = useState("0");
  const [businessTdsPct, setBusinessTdsPct] = useState("0");
  const [businessGstPct, setBusinessGstPct] = useState("0");
  const [sideBusinessEnabled, setSideBusinessEnabled] = useState(false);
  const [receiptAccountIds, setReceiptAccountIds] = useState<string[]>([]);

  // ─── Rent from a let-out property ───────────────────
  const [rentalRent, setRentalRent] = useState("0");
  const [rentalMunicipalTax, setRentalMunicipalTax] = useState("0");
  const [rentalLoanInterest, setRentalLoanInterest] = useState("0");

  // ─── Additional Income (shared all modes) ──────────
  const [expectedBonus, setExpectedBonus] = useState("0");
  const [salaryCreditDay, setSalaryCreditDay] = useState("25");
  const [cgEquityLtcg, setCgEquityLtcg] = useState("0");
  const [cgEquityStcg, setCgEquityStcg] = useState("0");
  const [cgDebt, setCgDebt] = useState("0");
  const [cgFd, setCgFd] = useState("0");
  const [cgGold, setCgGold] = useState("0");
  const [cgRealEstate, setCgRealEstate] = useState("0");

  // ─── Receipts tracking (Phase 3) ────────────────────
  const [receiptAccounts, setReceiptAccounts] = useState<ReceiptAccountOption[]>([]);
  const [bankCredits, setBankCredits] = useState<number | null>(null);
  const [creditCount, setCreditCount] = useState(0);

  // ─── Populate form from a profile (reusable for load + copy) ──
  const populateFormFromProfile = useCallback(
    (profile: SalaryProfile, ctcMultiplier = 1.0) => {
      setIncomeType(profile.income_type === "business" ? "business" : "salaried");
      setInputMode(profile.input_mode);
      // Restore manual override if one was saved (only when loading as-is, not with hike)
      const savedManual = profile.manual_monthly_in_hand ?? 0;
      setManualInHand(savedManual > 0 && ctcMultiplier === 1.0 ? String(savedManual) : "");
      setExpectedBonus(String(profile.expected_bonus ?? 0));
      setSalaryCreditDay(String(profile.salary_credit_day ?? 25));
      setCgEquityLtcg(String(profile.capital_gains_equity_ltcg ?? 0));
      setCgEquityStcg(String(profile.capital_gains_equity_stcg ?? 0));
      setCgDebt(String(profile.capital_gains_debt ?? 0));
      setCgFd(String(profile.capital_gains_fd ?? 0));
      setCgGold(String(profile.capital_gains_gold ?? 0));
      setCgRealEstate(String(profile.capital_gains_real_estate ?? 0));

      // Business, side income and rent — every mode keeps them so switching back doesn't lose them.
      const receipts = profile.business_receipts ?? 0;
      setBusinessScheme(profile.business_scheme ?? "presumptive_profession");
      setBusinessReceipts(receipts > 0 ? String(Math.round(receipts * ctcMultiplier)) : "");
      setBusinessDigitalPct(String(profile.business_digital_pct ?? 100));
      setBusinessExpenses(String(Math.round((profile.business_expenses ?? 0) * ctcMultiplier)));
      setBusinessTdsPct(String(profile.business_tds_pct ?? 0));
      setBusinessGstPct(String(profile.business_gst_pct ?? 0));
      setSideBusinessEnabled(profile.side_business_enabled === 1);
      setReceiptAccountIds(parseReceiptAccountIds(profile.business_receipt_account_ids));
      setRentalRent(String(profile.rental_annual_rent ?? 0));
      setRentalMunicipalTax(String(profile.rental_municipal_tax ?? 0));
      setRentalLoanInterest(String(profile.rental_loan_interest ?? 0));
      // Shared by CTC and business (state → professional tax; old-regime deductions).
      setState(profile.state);
      setDeductions80C(String(profile.deductions_80c));
      setDeductions80D(String(profile.deductions_80d));
      setHomeLoan(String(profile.home_loan_interest));
      setOtherDeductions(String(profile.other_deductions));

      if (profile.income_type === "business") return;

      if (profile.input_mode === "ctc") {
        const baseCTC = profile.annual_ctc ?? 0;
        setCtc(baseCTC > 0 ? String(Math.round(baseCTC * ctcMultiplier)) : "");
        setBasicPct(String(profile.basic_pct));
        setHraPct(String(profile.hra_pct));
        setIsMetro(profile.is_metro ? "yes" : "no");
        setEpfMode(profile.epf_mode);
        setEpfInCTC(profile.epf_in_ctc ? "yes" : "no");
        // Backward-compat: undefined (pre-v16.0.9 rows) treated as "yes"
        setGratuityInCTC(profile.gratuity_in_ctc === 0 ? "no" : "yes");
        setVpfMonthly(String(profile.vpf_monthly));
        setHraExemption(String(profile.hra_exemption_annual));
        // Manual breakdown fields (default 'percentage' for pre-v16.0.9 rows)
        setCtcMode(profile.ctc_mode === "manual" ? "manual" : "percentage");
        setManualBasic(String(Math.round((profile.manual_basic ?? 0) * ctcMultiplier)));
        setManualHra(String(Math.round((profile.manual_hra ?? 0) * ctcMultiplier)));
        setManualSpecial(String(Math.round((profile.manual_special ?? 0) * ctcMultiplier)));
        setManualEmployerEPF(String(Math.round((profile.manual_employer_epf ?? 0) * ctcMultiplier)));
        setManualGratuity(String(Math.round((profile.manual_gratuity ?? 0) * ctcMultiplier)));
      } else {
        let overrides: MonthlyOverrides = {};
        if (profile.monthly_overrides && ctcMultiplier === 1.0) {
          try {
            overrides = JSON.parse(profile.monthly_overrides);
          } catch {
            overrides = {};
          }
        }
        // computed_monthly_in_hand is the year's average — recover the default month from it.
        const baseSalary = ctcMultiplier === 1.0
          ? deriveDirectBaseMonthly(profile.computed_monthly_in_hand ?? 0, overrides)
          : profile.computed_monthly_in_hand ?? 0;
        setDirectMonthly(
          baseSalary > 0 ? String(Math.round(baseSalary * ctcMultiplier)) : "",
        );
        setMonthlyOverrides(overrides);
      }
    },
    [],
  );

  const resetFormToDefaults = useCallback(() => {
    setIncomeType("salaried");
    setInputMode("ctc");
    setIsDraft(false);
    setCtc("");
    setBasicPct("40");
    setHraPct("50");
    setIsMetro("yes");
    setEpfMode("restricted");
    setEpfInCTC("yes");
    setGratuityInCTC("yes");
    setVpfMonthly("0");
    setState(null);
    setCtcMode("percentage");
    setManualBasic("0");
    setManualHra("0");
    setManualSpecial("0");
    setManualEmployerEPF("0");
    setManualGratuity("0");
    setDeductions80C("0");
    setDeductions80D("0");
    setHraExemption("0");
    setHomeLoan("0");
    setOtherDeductions("0");
    setDirectMonthly("");
    setMonthlyOverrides({});
    setManualInHand("");
    setBusinessScheme("presumptive_profession");
    setBusinessReceipts("");
    setBusinessDigitalPct("100");
    setBusinessExpenses("0");
    setBusinessTdsPct("0");
    setBusinessGstPct("0");
    setSideBusinessEnabled(false);
    setReceiptAccountIds([]);
    setRentalRent("0");
    setRentalMunicipalTax("0");
    setRentalLoanInterest("0");
    setExpectedBonus("0");
    setSalaryCreditDay("25");
    setCgEquityLtcg("0");
    setCgEquityStcg("0");
    setCgDebt("0");
    setCgFd("0");
    setCgGold("0");
    setCgRealEstate("0");
  }, []);

  // ─── Load existing salary profile by FY ──
  // Defers reset until after the async load so form values don't flash to
  // empty defaults before the new FY data populates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingFY(true);

      const profile = await getSalaryProfileByFY(DEFAULT_USER_ID, selectedFY);
      if (cancelled) return;

      // Reset + apply in one batch — no intermediate "empty" render
      resetFormToDefaults();
      setExistingProfile(null);
      setPrevYearProfile(null);
      setShowCopyPrompt(false);
      setShowHikeInput(false);
      setHikePercent("");

      if (profile) {
        setExistingProfile(profile);
        setIsDraft(profile.status === "draft");
        populateFormFromProfile(profile);
        setLoadingFY(false);
        setLoaded(true);
      } else {
        const prevProfile = await getSalaryProfileByFY(
          DEFAULT_USER_ID,
          String(selectedFYNum - 1),
        );
        if (cancelled) return;
        if (prevProfile) {
          setPrevYearProfile(prevProfile);
          setShowCopyPrompt(true);
        }
        setLoadingFY(false);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedFY, selectedFYNum, populateFormFromProfile, resetFormToDefaults]);

  // ─── Accounts that can receive business payments ────
  useEffect(() => {
    let cancelled = false;
    getActiveAccounts(DEFAULT_USER_ID)
      .then((accounts) => {
        if (cancelled) return;
        setReceiptAccounts(
          accounts
            .filter((a) => RECEIPT_ACCOUNT_TYPES.has(a.account_type))
            .map((a) => ({
              id: a.id,
              label: a.account_label || `${a.bank_name} ••${a.account_identifier}`,
            })),
        );
      })
      .catch((e) => logger.error("Load receipt accounts failed:", e));
    return () => { cancelled = true; };
  }, []);

  // ─── Direct Mode Derived Values ─────────────────────
  const directAnnual = useMemo(() => {
    if (incomeType !== "salaried" || inputMode !== "direct") return 0;
    const defaultVal = num(directMonthly);
    const hasOverrides = Object.keys(monthlyOverrides).length > 0;
    if (!hasOverrides) return defaultVal * 12;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const ov = monthlyOverrides[i];
      sum += ov !== undefined ? num(ov) : defaultVal;
    }
    return sum;
  }, [incomeType, inputMode, directMonthly, monthlyOverrides]);

  const profTax = useMemo(() => getProfessionalTax(state), [state]);

  // ─── Everything the calculation reads, as numbers ───
  const profileNumbers: IncomeProfileNumbers = useMemo(() => ({
    income_type: incomeType,
    input_mode: incomeType === "business" ? "direct" : inputMode,
    annual_ctc: num(ctc) || null,
    basic_pct: num(basicPct) || 40,
    hra_pct: num(hraPct) || 50,
    is_metro: isMetro === "yes" ? 1 : 0,
    epf_mode: epfMode,
    epf_in_ctc: epfInCTC === "yes" ? 1 : 0,
    gratuity_in_ctc: gratuityInCTC === "yes" ? 1 : 0,
    vpf_monthly: num(vpfMonthly),
    state,
    deductions_80c: num(deductions80C),
    deductions_80d: num(deductions80D),
    hra_exemption_annual: incomeType === "business" ? 0 : num(hraExemption),
    home_loan_interest: num(homeLoan),
    other_deductions: num(otherDeductions),
    ctc_mode: ctcMode,
    manual_basic: num(manualBasic),
    manual_hra: num(manualHra),
    manual_special: num(manualSpecial),
    manual_employer_epf: num(manualEmployerEPF),
    manual_gratuity: num(manualGratuity),
    manual_monthly_in_hand: num(manualInHand),
    computed_monthly_in_hand: directAnnual / 12,
    expected_bonus: num(expectedBonus),
    capital_gains_equity_ltcg: num(cgEquityLtcg),
    capital_gains_equity_stcg: num(cgEquityStcg),
    capital_gains_debt: num(cgDebt),
    capital_gains_fd: num(cgFd),
    capital_gains_gold: num(cgGold),
    capital_gains_real_estate: num(cgRealEstate),
    business_scheme: businessScheme,
    business_receipts: num(businessReceipts),
    business_digital_pct: businessDigitalPct.trim() === "" ? 100 : num(businessDigitalPct),
    business_expenses: num(businessExpenses),
    business_tds_pct: num(businessTdsPct),
    side_business_enabled: sideBusinessEnabled ? 1 : 0,
    rental_annual_rent: num(rentalRent),
    rental_municipal_tax: num(rentalMunicipalTax),
    rental_loan_interest: num(rentalLoanInterest),
  }), [
    incomeType, inputMode, ctc, basicPct, hraPct, isMetro, epfMode, epfInCTC, gratuityInCTC,
    vpfMonthly, state, deductions80C, deductions80D, hraExemption, homeLoan, otherDeductions,
    ctcMode, manualBasic, manualHra, manualSpecial, manualEmployerEPF, manualGratuity,
    manualInHand, directAnnual, expectedBonus, cgEquityLtcg, cgEquityStcg, cgDebt, cgFd,
    cgGold, cgRealEstate, businessScheme, businessReceipts, businessDigitalPct,
    businessExpenses, businessTdsPct, sideBusinessEnabled, rentalRent, rentalMunicipalTax,
    rentalLoanInterest,
  ]);

  // Gains from withdrawals Arth recorded this tax year (services/realized-gains.ts). Added to the
  // figures typed in above for the calculation only - what's saved stays what was typed.
  const [autoGains, setAutoGains] = useState<WithdrawalGain[]>([]);
  useDataRefresh(
    useCallback(async () => {
      try {
        setAutoGains(await getRealizedGainsForTaxYear(DEFAULT_USER_ID, selectedFYNum));
      } catch {
        setAutoGains([]);
      }
    }, [selectedFYNum]),
  );
  const autoTax = useMemo(() => toTaxInputs(autoGains), [autoGains]);
  const calcNumbers = useMemo(
    () => ({
      ...profileNumbers,
      capital_gains_equity_ltcg: (profileNumbers.capital_gains_equity_ltcg ?? 0) + autoTax.input.equity_ltcg,
      capital_gains_equity_stcg: (profileNumbers.capital_gains_equity_stcg ?? 0) + autoTax.input.equity_stcg,
      capital_gains_debt: (profileNumbers.capital_gains_debt ?? 0) + autoTax.input.debt,
      capital_gains_gold: (profileNumbers.capital_gains_gold ?? 0) + autoTax.input.gold,
      capital_gains_crypto: autoTax.input.crypto ?? 0,
    }),
    [profileNumbers, autoTax],
  );

  const income = useMemo(
    () => computeIncomeProfile(calcNumbers, selectedFYNum, directAnnual),
    [calcNumbers, selectedFYNum, directAnnual],
  );
  const kind: IncomeKind = income.kind;
  const calculation = income.salary;
  const business = income.business;

  const hasSalaryData =
    kind === "ctc" ? !!calculation : kind === "direct" ? directAnnual > 0 : num(businessReceipts) > 0;

  // ─── Actual receipts (Phase 3) ──────────────────────
  const tracksReceipts = kind === "business" || (kind === "ctc" && sideBusinessEnabled);
  const receiptAccountKey = receiptAccountIds.join(",");
  useEffect(() => {
    if (!tracksReceipts || receiptAccountIds.length === 0) {
      setBankCredits(null);
      setCreditCount(0);
      return;
    }
    let cancelled = false;
    setBankCredits(null);
    getBusinessReceiptsForFY(DEFAULT_USER_ID, receiptAccountIds, selectedFYNum, startMonth)
      .then((r) => {
        if (cancelled) return;
        setBankCredits(r.total);
        setCreditCount(r.count);
      })
      .catch((e) => logger.error("Load business receipts failed:", e));
    return () => { cancelled = true; };
    // receiptAccountKey stands in for the array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksReceipts, receiptAccountKey, selectedFYNum, startMonth]);

  const fyFraction = useMemo(() => {
    const { start, end } = getFYRange(selectedFYNum, startMonth);
    const now = new Date();
    if (now < start) return 0;
    if (now >= end) return 1;
    return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  }, [selectedFYNum, startMonth]);

  const receiptsSoFar = bankCredits !== null
    ? grossUpBankReceipts(bankCredits, num(businessGstPct), num(businessTdsPct))
    : 0;
  const expectedSoFar = Math.round(num(businessReceipts) * fyFraction);
  const projectedAnnual =
    bankCredits !== null && fyFraction >= MIN_FRACTION_FOR_PROJECTION
      ? Math.round(receiptsSoFar / fyFraction)
      : null;

  const projected = useMemo(() => {
    if (projectedAnnual === null) return null;
    return computeIncomeProfile({ ...calcNumbers, business_receipts: projectedAnnual }, selectedFYNum, directAnnual);
  }, [projectedAnnual, calcNumbers, selectedFYNum, directAnnual]);

  const projectedDueByNow = useMemo(() => {
    const plan = projected?.advanceTax;
    if (!plan || !plan.required) return null;
    const today = todayIso();
    return plan.instalments.filter((i) => i.dueDate <= today).reduce((s, i) => s + i.amount, 0);
  }, [projected]);

  const toggleReceiptAccount = useCallback((id: string) => {
    setReceiptAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const businessInputProps: BusinessInputsProps = {
    scheme: businessScheme,
    onSchemeChange: setBusinessScheme,
    receipts: businessReceipts,
    onReceiptsChange: setBusinessReceipts,
    digitalPct: businessDigitalPct,
    onDigitalPctChange: setBusinessDigitalPct,
    expenses: businessExpenses,
    onExpensesChange: setBusinessExpenses,
    tdsPct: businessTdsPct,
    onTdsPctChange: setBusinessTdsPct,
    gstPct: businessGstPct,
    onGstPctChange: setBusinessGstPct,
  };

  const receiptsTracker = tracksReceipts && num(businessReceipts) > 0 && fyFraction > 0 ? (
    <ReceiptsTracker
      accounts={receiptAccounts}
      selectedIds={receiptAccountIds}
      onToggleAccount={toggleReceiptAccount}
      bankCredits={bankCredits}
      creditCount={creditCount}
      receiptsSoFar={receiptsSoFar}
      expectedSoFar={expectedSoFar}
      fyFraction={fyFraction}
      projectedAnnual={projectedAnnual}
      projectedTax={projected ? projected.annualTax : null}
      projectedDueByNow={projectedDueByNow}
      onUseProjected={() => {
        if (projectedAnnual !== null) setBusinessReceipts(String(projectedAnnual));
      }}
    />
  ) : null;

  // ─── Save to Salary Profile ────────────────────────
  const saveProfile = useCallback(async (status: "draft" | "complete") => {
    if (status === "complete") {
      if (kind === "ctc" && !calculation) {
        alert("Error", "Enter a valid CTC to calculate.");
        return;
      }
      if (kind === "direct" && directAnnual <= 0) {
        alert("Error", "Enter a valid monthly in-hand salary.");
        return;
      }
      if (kind === "business" && num(businessReceipts) <= 0) {
        alert("Error", "Enter your expected annual receipts.");
        return;
      }
    }

    // Direct draft with only the default typed: keep it so the draft reloads it.
    const monthlyInHand = kind === "direct" && directAnnual <= 0
      ? num(directMonthly)
      : income.monthlyInHand;

    setSaving(true);
    try {
      const totalCG =
        num(cgEquityLtcg) + num(cgEquityStcg) + num(cgDebt) +
        num(cgFd) + num(cgGold) + num(cgRealEstate);

      const profileData = {
        income_type: incomeType,
        // Business rows keep input_mode 'direct' (the column's CHECK allows only ctc/direct);
        // income_type is what marks them — see migration 077.
        input_mode: incomeType === "business" ? ("direct" as const) : inputMode,
        annual_ctc: kind === "ctc" ? num(ctc) || null : null,
        basic_pct: num(basicPct) || 40,
        hra_pct: num(hraPct) || 50,
        is_metro: isMetro === "yes",
        epf_mode: epfMode,
        epf_in_ctc: epfInCTC === "yes",
        gratuity_in_ctc: gratuityInCTC === "yes",
        ctc_mode: ctcMode,
        manual_basic: num(manualBasic),
        manual_hra: num(manualHra),
        manual_special: num(manualSpecial),
        manual_employer_epf: num(manualEmployerEPF),
        manual_gratuity: num(manualGratuity),
        vpf_monthly: num(vpfMonthly),
        tax_regime: calculation?.selectedRegime ?? business?.selectedRegime ?? ("new" as const),
        professional_tax_annual: profTax,
        state,
        deductions_80c: num(deductions80C),
        deductions_80d: num(deductions80D),
        hra_exemption_annual: num(hraExemption),
        home_loan_interest: num(homeLoan),
        other_deductions: num(otherDeductions),
        expected_bonus: num(expectedBonus),
        salary_credit_day: (() => {
          const n = parseInt(salaryCreditDay, 10);
          if (!Number.isFinite(n) || n < 1) return 25;
          if (n > 31) return 31;
          return n;
        })(),
        expected_capital_gains: totalCG,
        capital_gains_equity_ltcg: num(cgEquityLtcg),
        capital_gains_equity_stcg: num(cgEquityStcg),
        capital_gains_debt: num(cgDebt),
        capital_gains_fd: num(cgFd),
        capital_gains_gold: num(cgGold),
        capital_gains_real_estate: num(cgRealEstate),
        status,
        computed_monthly_in_hand: monthlyInHand,
        computed_annual_tax: income.annualTax,
        // The payslip correction only exists in CTC mode. Saving it from another mode left a
        // stale figure that reports (which read it as a fallback) could pick up.
        manual_monthly_in_hand: kind === "ctc" ? num(manualInHand) : 0,
        monthly_overrides: kind === "direct" && Object.keys(monthlyOverrides).length > 0
          ? JSON.stringify(monthlyOverrides)
          : null,
        business_scheme: businessScheme,
        business_receipts: num(businessReceipts),
        business_digital_pct: businessDigitalPct.trim() === "" ? 100 : num(businessDigitalPct),
        business_expenses: num(businessExpenses),
        business_tds_pct: num(businessTdsPct),
        business_gst_pct: num(businessGstPct),
        side_business_enabled: sideBusinessEnabled,
        rental_annual_rent: num(rentalRent),
        rental_municipal_tax: num(rentalMunicipalTax),
        rental_loan_interest: num(rentalLoanInterest),
        business_receipt_account_ids: receiptAccountIds.length > 0 ? JSON.stringify(receiptAccountIds) : null,
      };

      if (existingProfile) {
        await updateSalaryProfile(existingProfile.id, profileData);
      } else {
        await createSalaryProfile({
          yearly_plan_id: planId,
          financial_year: selectedFY,
          user_id: DEFAULT_USER_ID,
          ...profileData,
        });
      }

      if (status === "complete") {
        await deriveYearlyPlan(DEFAULT_USER_ID, selectedFY);
      }

      // Reload saved profile so screen reflects persisted state
      const saved = await getSalaryProfileByFY(DEFAULT_USER_ID, selectedFY);
      if (saved) {
        setExistingProfile(saved);
        setIsDraft(saved.status === "draft");
      }

      alert(
        status === "complete" ? "Saved" : "Draft Saved",
        status === "complete"
          ? "Income data saved and applied to your plan."
          : "Draft saved. You can come back to complete it later.",
      );
    } catch (e) {
      logger.error("Save salary profile failed:", e);
      alert("Error", formatError("Save salary data", e));
    } finally {
      setSaving(false);
    }
  }, [
    kind, income, calculation, business, directMonthly, directAnnual, selectedFY, planId,
    incomeType, inputMode, manualInHand, monthlyOverrides, ctc, basicPct, hraPct, isMetro, epfMode,
    epfInCTC, gratuityInCTC, ctcMode, manualBasic, manualHra, manualSpecial, manualEmployerEPF,
    manualGratuity, vpfMonthly, state, deductions80C, deductions80D, hraExemption, homeLoan,
    otherDeductions, profTax, expectedBonus, salaryCreditDay, cgEquityLtcg, cgEquityStcg, cgDebt,
    cgFd, cgGold, cgRealEstate, businessScheme, businessReceipts, businessDigitalPct,
    businessExpenses, businessTdsPct, businessGstPct, sideBusinessEnabled, rentalRent,
    rentalMunicipalTax, rentalLoanInterest, receiptAccountIds, existingProfile, alert,
  ]);

  const handleSaveDraft = useCallback(() => saveProfile("draft"), [saveProfile]);
  const handleSaveComplete = useCallback(() => saveProfile("complete"), [saveProfile]);

  // ─── Copy-from-previous-year helpers ────────────────
  const prevKind = prevYearProfile
    ? (prevYearProfile.income_type === "business" ? "business" : prevYearProfile.input_mode)
    : null;
  const prevAmount = !prevYearProfile
    ? 0
    : prevKind === "business"
      ? prevYearProfile.business_receipts ?? 0
      : prevKind === "ctc"
        ? prevYearProfile.annual_ctc ?? 0
        : (prevYearProfile.computed_monthly_in_hand ?? 0) * 12;
  const prevAmountLabel = prevKind === "business" ? "Receipts" : prevKind === "ctc" ? "CTC" : "Annual";

  // ─── Render ──────────────────────────────────────────
  // FY Picker → Copy Prompt → Draft → Income Type → Input Mode (salaried)
  //   → [Direct: Input + Summary/Empty]
  //   → [CTC: Input + EPF → Old Regime Deductions → Breakdown → Tax → Deductions → Hero]
  //   → [Business: Inputs → Old Regime Deductions → Hero + Breakdown → Tax → Advance Tax → Receipts]
  //   → Other Income (CTC + business) → Additional Income → Credit Day → Total + Save

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="calculator-outline" message="Loading calculator…" />
      </ScreenContainer>
    );
  }

  const showOtherIncome = (kind === "ctc" && !!calculation) || (kind === "business" && !!business && hasSalaryData);
  const otherIncomeAdvanceTax = kind === "ctc" ? income.advanceTax : null;

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View className="px-4 py-4" style={{ opacity: loadingFY ? 0.5 : 1 }} pointerEvents={loadingFY ? "none" : "auto"}>
            {/* ─── FY Picker ─────────────────────────── */}
            <View className="flex-row items-center justify-between mb-4">
              <Pressable
                onPress={() => setSelectedFY(String(selectedFYNum - 1))}
                disabled={loadingFY}
                className="p-2 rounded-lg bg-card"
              >
                <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
              </Pressable>
              <View className="px-4 py-2 rounded-lg" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                <Text className="text-sm font-bold" style={{ color: theme.primary }}>
                  {fyLabel}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedFY(String(selectedFYNum + 1))}
                disabled={loadingFY}
                className="p-2 rounded-lg bg-card"
              >
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* ─── Copy from Previous Year Prompt ─────── */}
            {showCopyPrompt && prevYearProfile && !existingProfile && (
              <Card className="mb-4">
                <View className="flex-row items-center mb-3">
                  <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                    <Ionicons name="copy-outline" size={18} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      No income data for {fyLabel}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      You have data from{" "}
                      {getFYLabel(selectedFYNum - 1, startMonth)}
                      {prevKind === "business" && prevAmount > 0
                        ? ` (Receipts: ${formatAmount(prevAmount)})`
                        : prevKind === "ctc" && prevAmount > 0
                          ? ` (CTC: ${formatAmount(prevAmount)})`
                          : prevKind === "direct" && prevYearProfile.computed_monthly_in_hand
                            ? ` (${formatAmount(prevYearProfile.computed_monthly_in_hand)}/mo)`
                            : ""}
                    </Text>
                  </View>
                </View>

                {!showHikeInput ? (
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Button
                        title="Copy As-Is"
                        variant="outline"
                        onPress={() => {
                          populateFormFromProfile(prevYearProfile);
                          setShowCopyPrompt(false);
                        }}
                      />
                    </View>
                    <View className="flex-1">
                      <Button
                        title={prevKind === "business" ? "Copy with Growth %" : "Copy with Hike %"}
                        onPress={() => setShowHikeInput(true)}
                      />
                    </View>
                  </View>
                ) : (
                  <View>
                    <Input
                      label={prevKind === "business" ? "Receipts Growth %" : "CTC Hike %"}
                      value={hikePercent}
                      onChangeText={setHikePercent}
                      keyboardType="numeric"
                      placeholder="e.g. 10"
                      containerClassName="mb-2"
                    />
                    {(() => {
                      const hike = num(hikePercent);
                      const newAmount = Math.round(prevAmount * (1 + hike / 100));
                      return prevAmount > 0 ? (
                        <View className="flex-row justify-between mb-3 px-1">
                          <Text className="text-xs text-muted-foreground">
                            Previous {prevAmountLabel}:{" "}
                            {formatAmount(prevAmount)}
                          </Text>
                          <Text className="text-xs font-semibold text-success">
                            New: {formatAmount(newAmount)}
                            {hike > 0 ? ` (+${hike}%)` : ""}
                          </Text>
                        </View>
                      ) : null;
                    })()}
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <Button
                          title="Cancel"
                          variant="outline"
                          onPress={() => {
                            setShowHikeInput(false);
                            setHikePercent("");
                          }}
                        />
                      </View>
                      <View className="flex-1">
                        <Button
                          title="Apply"
                          onPress={() => {
                            const multiplier = 1 + num(hikePercent) / 100;
                            populateFormFromProfile(prevYearProfile, multiplier);
                            setShowCopyPrompt(false);
                            setShowHikeInput(false);
                            setHikePercent("");
                          }}
                        />
                      </View>
                    </View>
                  </View>
                )}
              </Card>
            )}

            {/* ─── Draft Indicator ────────────────────── */}
            {isDraft && (
              <View className="flex-row items-center mb-3 px-3 py-2.5 rounded-lg bg-warning/8">
                <Ionicons name="document-outline" size={16} color={theme.warning} />
                <Text className="text-xs font-medium ml-2" style={{ color: theme.warning }}>
                  Draft - not yet saved to your plan
                </Text>
              </View>
            )}

            {/* ─── Income Type + Mode Toggles ─────────── */}
            <Toggle
              label="Income Type"
              options={[
                { label: "Salaried", value: "salaried" },
                { label: "Business / Freelance", value: "business" },
              ]}
              value={incomeType}
              onChange={(v) => setIncomeType(v as "salaried" | "business")}
            />

            {incomeType === "salaried" && (
              <Toggle
                label="Input Mode"
                options={[
                  { label: "CTC to In-Hand", value: "ctc" },
                  { label: "Direct Input", value: "direct" },
                ]}
                value={inputMode}
                onChange={(v) => setInputMode(v as "ctc" | "direct")}
              />
            )}

            {/* ════════════════════════════════════════════
                 DIRECT INPUT MODE
                ════════════════════════════════════════════ */}
            {kind === "direct" && (
              <>
              <InlineNote>
                All amounts here are considered post-tax. No tax rates will be applied.
              </InlineNote>
              <SalaryInputForm
                inputMode="direct"
                ctc={ctc}
                onCtcChange={setCtc}
                basicPct={basicPct}
                onBasicPctChange={setBasicPct}
                hraPct={hraPct}
                onHraPctChange={setHraPct}
                isMetro={isMetro}
                onIsMetroChange={setIsMetro}
                epfMode={epfMode}
                onEpfModeChange={(v) => setEpfMode(v as "full_basic" | "restricted")}
                epfInCTC={epfInCTC}
                onEpfInCTCChange={setEpfInCTC}
                gratuityInCTC={gratuityInCTC}
                onGratuityInCTCChange={setGratuityInCTC}
                vpfMonthly={vpfMonthly}
                onVpfMonthlyChange={setVpfMonthly}
                state={state}
                onStateChange={setState}
                profTax={profTax}
                ctcMode={ctcMode}
                onCtcModeChange={setCtcMode}
                manualBasic={manualBasic}
                onManualBasicChange={setManualBasic}
                manualHra={manualHra}
                onManualHraChange={setManualHra}
                manualSpecial={manualSpecial}
                onManualSpecialChange={setManualSpecial}
                manualEmployerEPF={manualEmployerEPF}
                onManualEmployerEPFChange={setManualEmployerEPF}
                manualGratuity={manualGratuity}
                onManualGratuityChange={setManualGratuity}
                directMonthly={directMonthly}
                onDirectMonthlyChange={setDirectMonthly}
                directAnnual={directAnnual}
                monthlyOverrides={monthlyOverrides}
                onMonthlyOverridesChange={setMonthlyOverrides}
                fyStartMonth={startMonth}
              />
              </>
            )}

            {/* ════════════════════════════════════════════
                 CTC MODE
                ════════════════════════════════════════════ */}
            {kind === "ctc" && (
              <>
                {/* CTC Input + EPF & Settings */}
                <SalaryInputForm
                  inputMode="ctc"
                  ctc={ctc}
                  onCtcChange={setCtc}
                  basicPct={basicPct}
                  onBasicPctChange={setBasicPct}
                  hraPct={hraPct}
                  onHraPctChange={setHraPct}
                  isMetro={isMetro}
                  onIsMetroChange={setIsMetro}
                  epfMode={epfMode}
                  onEpfModeChange={(v) => setEpfMode(v as "full_basic" | "restricted")}
                  epfInCTC={epfInCTC}
                  onEpfInCTCChange={setEpfInCTC}
                  gratuityInCTC={gratuityInCTC}
                  onGratuityInCTCChange={setGratuityInCTC}
                  vpfMonthly={vpfMonthly}
                  onVpfMonthlyChange={setVpfMonthly}
                  state={state}
                  onStateChange={setState}
                  profTax={profTax}
                  ctcMode={ctcMode}
                  onCtcModeChange={setCtcMode}
                  manualBasic={manualBasic}
                  onManualBasicChange={setManualBasic}
                  manualHra={manualHra}
                  onManualHraChange={setManualHra}
                  manualSpecial={manualSpecial}
                  onManualSpecialChange={setManualSpecial}
                  manualEmployerEPF={manualEmployerEPF}
                  onManualEmployerEPFChange={setManualEmployerEPF}
                  manualGratuity={manualGratuity}
                  onManualGratuityChange={setManualGratuity}
                  directMonthly={directMonthly}
                  onDirectMonthlyChange={setDirectMonthly}
                  directAnnual={directAnnual}
                  epfCeilingMonthly={getEpfMonthlyCeilingLabel(selectedFYNum)}
                  basicBelowHalf={
                    !!calculation &&
                    calculation.ctcBreakdown.grossSalary > 0 &&
                    calculation.ctcBreakdown.basic < calculation.ctcBreakdown.grossSalary * 0.5
                  }
                />

                {/* Old Regime Deductions */}
                <OldRegimeDeductions
                  deductions80C={deductions80C}
                  onDeductions80CChange={setDeductions80C}
                  deductions80D={deductions80D}
                  onDeductions80DChange={setDeductions80D}
                  hraExemption={hraExemption}
                  onHraExemptionChange={setHraExemption}
                  homeLoan={homeLoan}
                  onHomeLoanChange={setHomeLoan}
                  otherDeductions={otherDeductions}
                  onOtherDeductionsChange={setOtherDeductions}
                />

                {/* CTC Results (when calculation exists) */}
                {calculation && (
                  <>
                    {/* CTC Breakdown + EPF Contributions */}
                    <SalarySummary calculation={calculation} />

                    {/* Tax Comparison + Regime Summary */}
                    <TaxBreakdown calculation={calculation} />

                    {/* Annual Deductions */}
                    <AnnualDeductions calculation={calculation} />
                  </>
                )}

                {/* Empty state (no CTC entered) */}
                {!calculation && (
                  <SalarySummary calculation={null} />
                )}
              </>
            )}

            {/* ════════════════════════════════════════════
                 MONTHLY IN-HAND HERO (just above additional income)
                ════════════════════════════════════════════ */}
            {kind === "ctc" && calculation && (
              <MonthlyInHandHero calculation={calculation} manualInHand={manualInHand} onManualInHandChange={setManualInHand} />
            )}

            {/* ════════════════════════════════════════════
                 BUSINESS / FREELANCE MODE
                ════════════════════════════════════════════ */}
            {kind === "business" && (
              <>
                <Card className="mb-4">
                  <View className="flex-row items-center mb-3">
                    <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                      <Ionicons name="briefcase-outline" size={20} color={colors.blue} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-bold text-foreground">
                        Business / Freelance Income
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        Your estimate for {fyLabel}
                      </Text>
                    </View>
                  </View>
                  <BusinessInputs {...businessInputProps} />
                  <View className="mt-3">
                    <StatePicker value={state} onChange={setState} />
                    <View className="flex-row items-center px-1">
                      <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                      <Text className="text-xs text-faint-foreground ml-1">
                        Professional Tax: {formatAmount(profTax)}/year
                      </Text>
                    </View>
                  </View>
                </Card>

                <OldRegimeDeductions
                  deductions80C={deductions80C}
                  onDeductions80CChange={setDeductions80C}
                  deductions80D={deductions80D}
                  onDeductions80DChange={setDeductions80D}
                  hraExemption={hraExemption}
                  onHraExemptionChange={setHraExemption}
                  homeLoan={homeLoan}
                  onHomeLoanChange={setHomeLoan}
                  otherDeductions={otherDeductions}
                  onOtherDeductionsChange={setOtherDeductions}
                  showHra={false}
                />

                {business && hasSalaryData ? (
                  <>
                    <BusinessResults
                      business={business}
                      receipts={num(businessReceipts)}
                      expenses={num(businessExpenses)}
                    />
                    <TaxBreakdown calculation={business} />
                    {income.advanceTax && (
                      <AdvanceTaxCard
                        plan={income.advanceTax}
                        footnote="Includes tax on rent and other income below. Tax on capital gains is paid in the instalment after the gain happens."
                      />
                    )}
                    {receiptsTracker}
                  </>
                ) : (
                  <Card className="mb-4">
                    <View className="items-center py-6">
                      <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                        <Ionicons name="briefcase-outline" size={28} color={colors.blue} />
                      </View>
                      <Text className="text-base font-medium text-foreground mb-1">
                        Enter your receipts
                      </Text>
                      <Text className="text-sm text-muted-foreground text-center px-4">
                        Enter what you expect to bill this year to see your tax under both regimes,
                        your advance tax dates and your monthly in-hand.
                      </Text>
                    </View>
                  </Card>
                )}
              </>
            )}

            {/* ════════════════════════════════════════════
                 OTHER INCOME: side business + rent (CTC + business)
                ════════════════════════════════════════════ */}
            {showOtherIncome && (
              <OtherIncomeSection
                allowSideBusiness={kind === "ctc"}
                sideBusinessEnabled={sideBusinessEnabled}
                onSideBusinessEnabledChange={setSideBusinessEnabled}
                sideBusiness={businessInputProps}
                rentalRent={rentalRent}
                onRentalRentChange={setRentalRent}
                rentalMunicipalTax={rentalMunicipalTax}
                onRentalMunicipalTaxChange={setRentalMunicipalTax}
                rentalLoanInterest={rentalLoanInterest}
                onRentalLoanInterestChange={setRentalLoanInterest}
                result={income.other}
                primaryRegime={income.primaryRegime}
              />
            )}
            {otherIncomeAdvanceTax && (
              <AdvanceTaxCard
                plan={otherIncomeAdvanceTax}
                title="Advance Tax on Other Income"
                footnote="Your employer deducts tax on your salary. Tax on other income is yours to pay during the year."
              />
            )}
            {kind === "ctc" && receiptsTracker}

            {/* ════════════════════════════════════════════
                 ADDITIONAL INCOME (all modes, when data exists)
                ════════════════════════════════════════════ */}
            {hasSalaryData && (
              <AdditionalIncome
                expectedBonus={expectedBonus}
                onExpectedBonusChange={setExpectedBonus}
                bonusTaxResult={income.bonus}
                cgEquityLtcg={cgEquityLtcg}
                onCgEquityLtcgChange={setCgEquityLtcg}
                cgEquityStcg={cgEquityStcg}
                onCgEquityStcgChange={setCgEquityStcg}
                cgDebt={cgDebt}
                onCgDebtChange={setCgDebt}
                cgFd={cgFd}
                onCgFdChange={setCgFd}
                cgGold={cgGold}
                onCgGoldChange={setCgGold}
                cgRealEstate={cgRealEstate}
                onCgRealEstateChange={setCgRealEstate}
                capitalGainsTaxResult={income.capitalGains}
                additionalIncomeNet={(income.bonus?.netBonus ?? 0) + (income.capitalGains?.totalNet ?? 0)}
                showBonus={kind !== "business"}
              />
            )}
            {hasSalaryData && autoGains.length > 0 && (
              <WithdrawalGainsCard gains={autoGains} cryptoTds={autoTax.cryptoTds} />
            )}

            {/* ════════════════════════════════════════════
                 PAY-DAY — day of month when income is credited
                ════════════════════════════════════════════ */}
            {hasSalaryData && (
              <Card className="mb-4">
                <Input
                  label={kind === "business" ? "Usual Payment Day (1–31)" : "Salary Credit Day (1–31)"}
                  value={salaryCreditDay}
                  onChangeText={setSalaryCreditDay}
                  placeholder="25"
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text className="text-xs text-muted-foreground mt-2">
                  Used for on-track checks. Until this date, the current month isn't counted as
                  "elapsed" for investment/milestone warnings - avoids false alarms when you're
                  paid later in the month.
                </Text>
              </Card>
            )}

            {/* ════════════════════════════════════════════
                 GRAND TOTAL + CG REFERENCE + SAVE
                ════════════════════════════════════════════ */}
            <SalaryFooter
              primaryLabel={kind === "business" ? "Business" : "Salary"}
              primaryAnnual={income.primaryAnnualInHand}
              otherIncomeNet={income.other?.netCash ?? 0}
              netBonus={income.netBonus}
              netCapitalGains={income.netCapitalGains}
              hasSalaryData={hasSalaryData}
              totalIncome={income.totalAnnualIncome}
              saving={saving}
              onSaveDraft={handleSaveDraft}
              onSaveComplete={handleSaveComplete}
              onCapitalGainsReference={() => router.push("/goals/capital-gains-reference")}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

/**
 * Capital gains from withdrawals Arth recorded this tax year - already included in the capital
 * gains tax above, on top of anything typed in. One row per withdrawal.
 */
function WithdrawalGainsCard({ gains, cryptoTds }: { gains: WithdrawalGain[]; cryptoTds: number }) {
  const theme = useTheme();
  const CLASS: Record<WithdrawalGain["assetClass"], string> = { equity: "Equity", debt: "Debt", gold: "Gold", crypto: "Crypto" };
  const total = gains.reduce((sum, g) => sum + g.gain, 0);
  return (
    <Card className="mt-3">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From your withdrawals</Text>
      <Text className="text-xs text-muted-foreground mt-1 mb-2">
        Included in the capital gains tax above, on top of anything you typed in.
      </Text>
      {gains.map((g) => {
        const term = g.assetClass === "crypto" || g.assetClass === "debt" ? "" : g.longTerm !== 0 && g.shortTerm !== 0 ? " · part long-term" : g.longTerm !== 0 ? " · long-term" : " · short-term";
        return (
          <View key={g.transferId} className="flex-row items-center py-2 border-t border-border">
            <View className="flex-1 mr-2">
              <Text className="text-sm text-foreground" numberOfLines={1}>{g.accountName}</Text>
              <Text className="text-xs text-muted-foreground">
                {formatDate(g.date)} · {CLASS[g.assetClass]}{term} · took out {formatAmount(g.proceeds)}, cost {formatAmount(g.cost)}
              </Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: g.gain >= 0 ? theme.success : theme.danger }}>
              {g.gain >= 0 ? "+" : "−"}{formatAmount(Math.abs(g.gain))}
            </Text>
          </View>
        );
      })}
      <View className="flex-row justify-between pt-2 border-t border-border">
        <Text className="text-sm font-semibold text-foreground">Realised this year</Text>
        <Text className="text-sm font-bold text-foreground">
          {total < 0 ? "−" : ""}{formatAmount(Math.abs(total))}
        </Text>
      </View>
      {cryptoTds > 0 && (
        <Text className="text-xs text-muted-foreground mt-2">
          {`Crypto exchanges deduct 1% TDS when you sell - about ${formatAmount(cryptoTds)} here. It counts towards your tax: claim it when you file. A crypto loss can't be set off against any gain.`}
        </Text>
      )}
    </Card>
  );
}

