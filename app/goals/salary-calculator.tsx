import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable, KeyboardAvoidingView, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  calculateSalary,
  getProfessionalTax,
  computeBonusTax,
  computeCapitalGainsTax,
  type SalaryCalculation,
  type CapitalGainsTaxInput,
} from "@/services/tax-engine";
import {
  getSalaryProfileByFY,
  createSalaryProfile,
  updateSalaryProfile,
} from "@/services/salary-profile";
import type { SalaryProfile } from "@/services/salary-profile";
import { deriveYearlyPlan } from "@/services/yearly-plan";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";
import { Toggle } from "@/components/goals";
import { SalaryInputForm, type MonthlyOverrides } from "@/components/goals/SalaryInputForm";
import { OldRegimeDeductions, AnnualDeductions, AdditionalIncome } from "@/components/goals/DeductionsSection";
import { TaxBreakdown } from "@/components/goals/TaxBreakdown";
import { MonthlyInHandHero, SalarySummary, SalaryFooter } from "@/components/goals/SalarySummary";


import { useTheme } from "@/hooks/use-theme";

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

  // ─── Additional Income (shared both modes) ──────────
  const [expectedBonus, setExpectedBonus] = useState("0");
  const [salaryCreditDay, setSalaryCreditDay] = useState("25");
  const [cgEquityLtcg, setCgEquityLtcg] = useState("0");
  const [cgEquityStcg, setCgEquityStcg] = useState("0");
  const [cgDebt, setCgDebt] = useState("0");
  const [cgFd, setCgFd] = useState("0");
  const [cgGold, setCgGold] = useState("0");
  const [cgRealEstate, setCgRealEstate] = useState("0");

  // ─── Populate form from a profile (reusable for load + copy) ──
  const populateFormFromProfile = useCallback(
    (profile: SalaryProfile, ctcMultiplier = 1.0) => {
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
        setState(profile.state);
        setDeductions80C(String(profile.deductions_80c));
        setDeductions80D(String(profile.deductions_80d));
        setHraExemption(String(profile.hra_exemption_annual));
        setHomeLoan(String(profile.home_loan_interest));
        setOtherDeductions(String(profile.other_deductions));
        // Manual breakdown fields (default 'percentage' for pre-v16.0.9 rows)
        setCtcMode(profile.ctc_mode === "manual" ? "manual" : "percentage");
        setManualBasic(String(Math.round((profile.manual_basic ?? 0) * ctcMultiplier)));
        setManualHra(String(Math.round((profile.manual_hra ?? 0) * ctcMultiplier)));
        setManualSpecial(String(Math.round((profile.manual_special ?? 0) * ctcMultiplier)));
        setManualEmployerEPF(String(Math.round((profile.manual_employer_epf ?? 0) * ctcMultiplier)));
        setManualGratuity(String(Math.round((profile.manual_gratuity ?? 0) * ctcMultiplier)));
      } else {
        const baseSalary = profile.computed_monthly_in_hand ?? 0;
        setDirectMonthly(
          baseSalary > 0 ? String(Math.round(baseSalary * ctcMultiplier)) : "",
        );
        if (profile.monthly_overrides && ctcMultiplier === 1.0) {
          try {
            setMonthlyOverrides(JSON.parse(profile.monthly_overrides));
          } catch {
            setMonthlyOverrides({});
          }
        } else {
          setMonthlyOverrides({});
        }
      }
    },
    [],
  );

  const resetFormToDefaults = useCallback(() => {
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

  // ─── CTC Calculation ────────────────────────────────
  const calculation: SalaryCalculation | null = useMemo(() => {
    if (inputMode !== "ctc") return null;
    const annualCTC = parseFloat(ctc) || 0;
    if (annualCTC <= 0) return null;

    const manualBreakdown =
      ctcMode === "manual"
        ? {
            basic: parseFloat(manualBasic) || 0,
            hra: parseFloat(manualHra) || 0,
            specialAllowance: parseFloat(manualSpecial) || 0,
            employerEPF: parseFloat(manualEmployerEPF) || 0,
            gratuity: parseFloat(manualGratuity) || 0,
          }
        : undefined;

    return calculateSalary({
      annualCTC,
      basicPct: parseFloat(basicPct) || 40,
      hraPct: parseFloat(hraPct) || 50,
      isMetro: isMetro === "yes",
      epfMode,
      epfInCTC: epfInCTC === "yes",
      gratuityInCTC: gratuityInCTC === "yes",
      vpfMonthly: parseFloat(vpfMonthly) || 0,
      professionalTaxAnnual: getProfessionalTax(state),
      deductions80C: parseFloat(deductions80C) || 0,
      deductions80D: parseFloat(deductions80D) || 0,
      hraExemptionAnnual: parseFloat(hraExemption) || 0,
      homeLoanInterest: parseFloat(homeLoan) || 0,
      otherDeductions: parseFloat(otherDeductions) || 0,
      manualBreakdown,
    });
  }, [
    inputMode, ctc, basicPct, hraPct, isMetro, epfMode, epfInCTC, gratuityInCTC,
    vpfMonthly, state, deductions80C, deductions80D, hraExemption,
    homeLoan, otherDeductions,
    ctcMode, manualBasic, manualHra, manualSpecial, manualEmployerEPF, manualGratuity,
  ]);

  // ─── Direct Mode Derived Values ─────────────────────
  const directAnnual = useMemo(() => {
    if (inputMode !== "direct") return 0;
    const defaultVal = parseFloat(directMonthly) || 0;
    const hasOverrides = Object.keys(monthlyOverrides).length > 0;
    if (!hasOverrides) return defaultVal * 12;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const ov = monthlyOverrides[i];
      sum += ov !== undefined ? (parseFloat(ov) || 0) : defaultVal;
    }
    return sum;
  }, [inputMode, directMonthly, monthlyOverrides]);

  const profTax = useMemo(() => getProfessionalTax(state), [state]);

  // ─── Tax Computation Context ────────────────────────
  const grossSalaryForTax = useMemo(() => {
    if (inputMode === "ctc" && calculation) {
      return calculation.ctcBreakdown.grossSalary;
    }
    return directAnnual;
  }, [inputMode, calculation, directAnnual]);

  const taxRegimeForCalc = useMemo((): "new" | "old" => {
    if (inputMode === "ctc" && calculation) {
      return calculation.selectedRegime;
    }
    return "new";
  }, [inputMode, calculation]);

  // ─── Bonus Tax ──────────────────────────────────────
  const bonusTaxResult = useMemo(() => {
    if (inputMode === "direct") return null;
    const bonus = parseFloat(expectedBonus) || 0;
    if (bonus <= 0) return null;
    return computeBonusTax(grossSalaryForTax, bonus, taxRegimeForCalc);
  }, [inputMode, expectedBonus, grossSalaryForTax, taxRegimeForCalc]);

  // ─── Capital Gains Tax ──────────────────────────────
  const capitalGainsTaxResult = useMemo(() => {
    if (inputMode === "direct") return null;
    const gains: CapitalGainsTaxInput = {
      equity_ltcg: parseFloat(cgEquityLtcg) || 0,
      equity_stcg: parseFloat(cgEquityStcg) || 0,
      debt: parseFloat(cgDebt) || 0,
      fd: parseFloat(cgFd) || 0,
      gold: parseFloat(cgGold) || 0,
      real_estate: parseFloat(cgRealEstate) || 0,
    };
    const hasGains = Object.values(gains).some((v) => v > 0);
    if (!hasGains) return null;
    return computeCapitalGainsTax(gains, grossSalaryForTax, taxRegimeForCalc);
  }, [inputMode, cgEquityLtcg, cgEquityStcg, cgDebt, cgFd, cgGold, cgRealEstate, grossSalaryForTax, taxRegimeForCalc]);

  // ─── Total Income (post-tax) ────────────────────────
  const totalIncome = useMemo(() => {
    const parsedManual = parseFloat(manualInHand) || 0;
    const salary = inputMode === "ctc"
      ? (parsedManual > 0 ? parsedManual * 12 : (calculation?.annualInHand ?? 0))
      : directAnnual;
    // Direct mode: all amounts are already post-tax, no deductions
    const netBonus = bonusTaxResult ? bonusTaxResult.netBonus : (parseFloat(expectedBonus) || 0);
    const netCG = capitalGainsTaxResult?.totalNet ?? (
      (parseFloat(cgEquityLtcg) || 0) + (parseFloat(cgEquityStcg) || 0) +
      (parseFloat(cgDebt) || 0) + (parseFloat(cgFd) || 0) +
      (parseFloat(cgGold) || 0) + (parseFloat(cgRealEstate) || 0)
    );
    return salary + netBonus + netCG;
  }, [inputMode, calculation, directAnnual, manualInHand, bonusTaxResult, expectedBonus, capitalGainsTaxResult, cgEquityLtcg, cgEquityStcg, cgDebt, cgFd, cgGold, cgRealEstate]);

  const hasSalaryData = inputMode === "ctc" ? !!calculation : directAnnual > 0;

  const additionalIncomeNet = useMemo(() => {
    const netBonus = bonusTaxResult?.netBonus ?? 0;
    const netCG = capitalGainsTaxResult?.totalNet ?? 0;
    return netBonus + netCG;
  }, [bonusTaxResult, capitalGainsTaxResult]);

  // ─── Save to Salary Profile ────────────────────────
  const saveProfile = useCallback(async (status: "draft" | "complete") => {
    let monthlyInHand = 0;
    let annualTax = 0;

    if (status === "complete") {
      if (inputMode === "ctc") {
        if (!calculation) {
          alert("Error", "Enter a valid CTC to calculate.");
          return;
        }
        const parsedManualSave = parseFloat(manualInHand) || 0;
        monthlyInHand = parsedManualSave > 0 ? parsedManualSave : calculation.monthlyInHand;
        annualTax =
          calculation.selectedRegime === "new"
            ? calculation.newRegimeTax.totalTax
            : calculation.oldRegimeTax.totalTax;
      } else {
        if (directAnnual <= 0) {
          alert("Error", "Enter a valid monthly in-hand salary.");
          return;
        }
        monthlyInHand = directAnnual / 12;
        annualTax = 0;
      }
    } else {
      if (inputMode === "ctc" && calculation) {
        const parsedManualDraft = parseFloat(manualInHand) || 0;
        monthlyInHand = parsedManualDraft > 0 ? parsedManualDraft : calculation.monthlyInHand;
        annualTax =
          calculation.selectedRegime === "new"
            ? calculation.newRegimeTax.totalTax
            : calculation.oldRegimeTax.totalTax;
      } else if (inputMode === "direct") {
        monthlyInHand = directAnnual > 0 ? directAnnual / 12 : (parseFloat(directMonthly) || 0);
      }
    }

    setSaving(true);
    try {
      const totalCG =
        (parseFloat(cgEquityLtcg) || 0) +
        (parseFloat(cgEquityStcg) || 0) +
        (parseFloat(cgDebt) || 0) +
        (parseFloat(cgFd) || 0) +
        (parseFloat(cgGold) || 0) +
        (parseFloat(cgRealEstate) || 0);

      const profileData = {
        input_mode: inputMode,
        annual_ctc: inputMode === "ctc" ? parseFloat(ctc) || null : null,
        basic_pct: parseFloat(basicPct) || 40,
        hra_pct: parseFloat(hraPct) || 50,
        is_metro: isMetro === "yes",
        epf_mode: epfMode,
        epf_in_ctc: epfInCTC === "yes",
        gratuity_in_ctc: gratuityInCTC === "yes",
        ctc_mode: ctcMode,
        manual_basic: parseFloat(manualBasic) || 0,
        manual_hra: parseFloat(manualHra) || 0,
        manual_special: parseFloat(manualSpecial) || 0,
        manual_employer_epf: parseFloat(manualEmployerEPF) || 0,
        manual_gratuity: parseFloat(manualGratuity) || 0,
        vpf_monthly: parseFloat(vpfMonthly) || 0,
        tax_regime: calculation?.selectedRegime ?? ("new" as const),
        professional_tax_annual: profTax,
        state,
        deductions_80c: parseFloat(deductions80C) || 0,
        deductions_80d: parseFloat(deductions80D) || 0,
        hra_exemption_annual: parseFloat(hraExemption) || 0,
        home_loan_interest: parseFloat(homeLoan) || 0,
        other_deductions: parseFloat(otherDeductions) || 0,
        expected_bonus: parseFloat(expectedBonus) || 0,
        salary_credit_day: (() => {
          const n = parseInt(salaryCreditDay, 10);
          if (!Number.isFinite(n) || n < 1) return 25;
          if (n > 31) return 31;
          return n;
        })(),
        expected_capital_gains: totalCG,
        capital_gains_equity_ltcg: parseFloat(cgEquityLtcg) || 0,
        capital_gains_equity_stcg: parseFloat(cgEquityStcg) || 0,
        capital_gains_debt: parseFloat(cgDebt) || 0,
        capital_gains_fd: parseFloat(cgFd) || 0,
        capital_gains_gold: parseFloat(cgGold) || 0,
        capital_gains_real_estate: parseFloat(cgRealEstate) || 0,
        status,
        computed_monthly_in_hand: monthlyInHand,
        computed_annual_tax: annualTax,
        manual_monthly_in_hand: parseFloat(manualInHand) || 0,
        monthly_overrides: inputMode === "direct" && Object.keys(monthlyOverrides).length > 0
          ? JSON.stringify(monthlyOverrides)
          : null,
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
    selectedFY, planId, inputMode, calculation, directMonthly, directAnnual,
    manualInHand, monthlyOverrides, ctc, basicPct, hraPct, isMetro, epfMode, epfInCTC,
    gratuityInCTC, ctcMode, manualBasic, manualHra, manualSpecial, manualEmployerEPF, manualGratuity,
    vpfMonthly,
    state, deductions80C, deductions80D, hraExemption, homeLoan,
    otherDeductions, profTax, expectedBonus, salaryCreditDay, cgEquityLtcg,
    cgEquityStcg, cgDebt, cgFd, cgGold, cgRealEstate,
    existingProfile, router,
  ]);

  const handleSaveDraft = useCallback(() => saveProfile("draft"), [saveProfile]);
  const handleSaveComplete = useCallback(() => saveProfile("complete"), [saveProfile]);

  // ─── Render ──────────────────────────────────────────
  // Section order matches original:
  //   FY Picker → Copy Prompt → Draft → Mode Toggle
  //   → [Direct: Input + Summary/Empty]
  //   → [CTC: Input + EPF Settings → Old Regime Deductions
  //          → Hero + CTC Breakdown + EPF Contributions
  //          → Tax Comparison + Regime Summary
  //          → Annual Deductions
  //          → Empty state (if no calc)]
  //   → Additional Income (both modes)
  //   → Grand Total → CG Reference → Save

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="calculator-outline" message="Loading calculator…" />
      </ScreenContainer>
    );
  }

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
                      {prevYearProfile.input_mode === "ctc" && prevYearProfile.annual_ctc
                        ? ` (CTC: ${formatAmount(prevYearProfile.annual_ctc)})`
                        : prevYearProfile.input_mode === "direct" && prevYearProfile.computed_monthly_in_hand
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
                        title="Copy with Hike %"
                        onPress={() => setShowHikeInput(true)}
                      />
                    </View>
                  </View>
                ) : (
                  <View>
                    <Input
                      label="CTC Hike %"
                      value={hikePercent}
                      onChangeText={setHikePercent}
                      keyboardType="numeric"
                      placeholder="e.g. 10"
                      containerClassName="mb-2"
                    />
                    {(() => {
                      const hike = parseFloat(hikePercent) || 0;
                      const prevAmount =
                        prevYearProfile.input_mode === "ctc"
                          ? prevYearProfile.annual_ctc ?? 0
                          : (prevYearProfile.computed_monthly_in_hand ?? 0) * 12;
                      const newAmount = Math.round(prevAmount * (1 + hike / 100));
                      const isCtcMode = prevYearProfile.input_mode === "ctc";
                      return prevAmount > 0 ? (
                        <View className="flex-row justify-between mb-3 px-1">
                          <Text className="text-xs text-muted-foreground">
                            Previous {isCtcMode ? "CTC" : "Annual"}:{" "}
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
                            const multiplier =
                              1 + (parseFloat(hikePercent) || 0) / 100;
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
                <Ionicons name="document-outline" size={16} color={STATUS_COLORS.warning} />
                <Text className="text-xs font-medium ml-2" style={{ color: theme.warning }}>
                  Draft - not yet saved to your plan
                </Text>
              </View>
            )}

            {/* ─── Mode Toggle ────────────────────────── */}
            <Toggle
              label="Input Mode"
              options={[
                { label: "CTC to In-Hand", value: "ctc" },
                { label: "Direct Input", value: "direct" },
              ]}
              value={inputMode}
              onChange={(v) => setInputMode(v as "ctc" | "direct")}
            />

            {/* ════════════════════════════════════════════
                 DIRECT INPUT MODE
                ════════════════════════════════════════════ */}
            {inputMode === "direct" && (
              <>
              <View className="flex-row items-center px-3 py-2.5 rounded-lg mb-3 bg-primary/8">
                <Ionicons name="information-circle-outline" size={16} color={colors.blue} />
                <Text className="text-xs text-muted-foreground ml-2 flex-1">
                  All amounts here are considered post-tax. No tax rates will be applied.
                </Text>
              </View>
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
            {inputMode === "ctc" && (
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
            {inputMode === "ctc" && calculation && (
              <MonthlyInHandHero calculation={calculation} manualInHand={manualInHand} onManualInHandChange={setManualInHand} />
            )}

            {/* ════════════════════════════════════════════
                 ADDITIONAL INCOME (both modes, when data exists)
                ════════════════════════════════════════════ */}
            {hasSalaryData && (
              <AdditionalIncome
                expectedBonus={expectedBonus}
                onExpectedBonusChange={setExpectedBonus}
                bonusTaxResult={bonusTaxResult}
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
                capitalGainsTaxResult={capitalGainsTaxResult}
                additionalIncomeNet={additionalIncomeNet}
              />
            )}

            {/* ════════════════════════════════════════════
                 PAY-DAY — day of month when salary is credited
                ════════════════════════════════════════════ */}
            {hasSalaryData && (
              <Card className="mb-4">
                <Input
                  label="Salary Credit Day (1–31)"
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
              inputMode={inputMode}
              manualInHand={manualInHand}
              calculation={calculation}
              directAnnual={directAnnual}
              hasSalaryData={hasSalaryData}
              totalIncome={totalIncome}
              bonusTaxResult={bonusTaxResult}
              expectedBonus={expectedBonus}
              capitalGainsTaxResult={capitalGainsTaxResult}
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
