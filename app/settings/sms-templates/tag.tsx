import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  TokenTagger,
  FIELD_COLORS,
} from "@/components/sms-templates/TokenTagger";
import {
  compileTemplate,
  testTemplate,
  autoTag,
  explainCompileError,
  type TaggedField,
  type TaggedSpan,
} from "@/services/sms/template-compiler";
import {
  getDraft,
  updateDraft,
  clearDraft,
} from "@/services/sms/template-draft-store";
import {
  createUserTemplate,
  updateUserTemplate,
  findDuplicateUserTemplate,
  testPatternAgainstUnrecognised,
  type UserTxType,
  type SenderMatchMode,
} from "@/services/sms/user-sms-templates";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { DEFAULT_USER_ID } from "@/constants/app";

/**
 * v15.6.0 — SMS template tagger screen.
 *
 * Shows:
 *   - Six field rows — tap to activate, tap to clear
 *   - SMS body as tappable tokens (TokenTagger)
 *   - Live preview of extracted values + inline compile error explanation
 *   - Transaction type radio
 *   - Bank name field with dismissible suggestion dropdown
 *   - Optional "Test with another SMS" and "Test against recent unrecognised SMS"
 *   - Collapsible regex preview (for power users)
 *   - Save button
 *
 * New in v15.6.0:
 *   - Auto-tag ("Guess it for me") button — one-tap first guess
 *   - Per-field Clear button
 *   - Sticky active-field banner above the SMS card (no scroll-up-scroll-down)
 *   - Inline compile error explanation (replaces alert-on-save)
 *   - Duplicate-template warning before save
 *   - Test-against-unrecognised SMS button
 *   - Bank dropdown dismisses on exact match, outside tap, and keyboard hide
 *   - Step indicator (1 / 2 / 3)
 */

const FIELDS: TaggedField[] = ["amount", "account", "merchant", "date", "balance", "ref"];

/**
 * v15.10.0 — user-visible "what does each field look like?" helper, shown
 * on tap of the info icon per field row. Kept in sync with FIELD_REGEX in
 * template-compiler.ts — if you change the regex, update the text here too.
 */
const FIELD_FORMAT_HELP: Record<TaggedField, { format: string; examples: string }> = {
  amount: {
    format: "Digits with optional decimals",
    examples: "1,500   ·   1500.00   ·   200",
  },
  account: {
    format: "Last 3–6 digits of a card/savings, OR the exact nickname of a wallet account",
    examples: "1234   ·   X1234   ·   Amazon Pay Wallet   ·   TataNeu Coins",
  },
  merchant: {
    format: "Text, one or more words",
    examples: "AMAZON   ·   Swiggy Ltd   ·   UBER INDIA",
  },
  date: {
    format: "Day-Month-Year, optionally with time",
    examples: "10-04-26   ·   10/04/2026   ·   10-APR-2026   ·   10/04/26 14:30",
  },
  balance: {
    format: "Digits with optional decimals",
    examples: "50,000   ·   49999.50",
  },
  ref: {
    format: "Alphanumeric with optional -/.&':#",
    examples: "UPI/123456789012   ·   NEFT-REF-55123   ·   IMPS/R/0429",
  },
};

const BANK_SUGGESTIONS = [
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "SBI",
  "Kotak Mahindra Bank",
  "Yes Bank",
  "IDFC FIRST Bank",
  "IndusInd Bank",
  "RBL Bank",
  "Federal Bank",
  "HSBC",
  "Standard Chartered",
  "Citi Bank",
  "PNB",
  "Canara Bank",
  "Bank of Baroda",
  "Union Bank of India",
  "Indian Bank",
  "Bank of India",
  "Bank of Maharashtra",
  "Central Bank of India",
  "Indian Overseas Bank",
  "UCO Bank",
  "Punjab & Sind Bank",
  "Paytm Payments Bank",
  "Airtel Payments Bank",
  "Jio Payments Bank",
];

export default function TagSmsTemplateScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const draft = getDraft();

  const [spans, setSpans] = useState<TaggedSpan[]>(draft?.spans ?? []);
  const [activeField, setActiveField] = useState<TaggedField | null>(null);
  const [bankName, setBankName] = useState<string>(draft?.bankName ?? "");
  const [txType, setTxType] = useState<UserTxType>(draft?.txType ?? "debit");
  const [label, setLabel] = useState<string>(draft?.label ?? "");
  // v15.11.0: sender-based routing state.
  const [senderPattern, setSenderPattern] = useState<string>(draft?.senderPattern ?? "");
  const [senderMatchMode, setSenderMatchMode] = useState<SenderMatchMode>(draft?.senderMatchMode ?? "code");
  const [defaultPaymentModeId, setDefaultPaymentModeId] = useState<string | null>(draft?.defaultPaymentModeId ?? null);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [showPaymentModePicker, setShowPaymentModePicker] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [testSample, setTestSample] = useState("");
  const [testResult, setTestResult] = useState<
    { ok: true; extracted: Partial<Record<TaggedField, string>> } | { ok: false } | null
  >(null);
  const [unrecResult, setUnrecResult] = useState<{ matched: number; total: number; samples: string[] } | null>(null);
  const [unrecLoading, setUnrecLoading] = useState(false);
  const [duplicateFound, setDuplicateFound] = useState<{ id: string; label: string } | null>(null);
  const [showRegexPreview, setShowRegexPreview] = useState(false);
  // v15.13.0: manual regex edit mode — restored from draft when editing a template
  // that was previously saved with a manual override.
  const [useManualRegex, setUseManualRegex] = useState(draft?.useManualRegex ?? false);
  const [manualRegex, setManualRegex] = useState(draft?.manualRegex ?? "");
  // v15.10.0: per-field format helper shown on info-icon tap.
  const [expandedHelpField, setExpandedHelpField] = useState<TaggedField | null>(null);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const smsBody = draft?.smsBody ?? "";

  // v15.11.2: suppress the hot-reload-fallback redirect during save. The
  // save flow legitimately empties the draft (clearDraft after the
  // replace() call) and we don't want an interstitial remount to pop
  // the user onto /new in the split-second before the stack settles.
  const savingRef = useRef(false);

  // Redirect back to paste screen if draft is missing (e.g. hot reload).
  useEffect(() => {
    if (!smsBody && !savingRef.current) {
      router.replace("/settings/sms-templates/new" as never);
    }
  }, [smsBody, router]);

  // Persist changes to draft store so Back re-entry doesn't lose them.
  useEffect(() => {
    updateDraft({ spans, bankName, txType, label, senderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId });
  }, [spans, bankName, txType, label, senderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId]);

  // v15.11.0: the "effective" sender string we'll actually save, after
  // auto-extraction when mode = code. Displayed below the input so the user
  // sees what the matcher will compare against.
  const effectiveSenderPattern = useMemo(() => {
    const raw = senderPattern.trim();
    if (!raw) return "";
    if (senderMatchMode === "code") {
      const match = raw.toUpperCase().match(/[A-Z]{4,}/);
      return match ? match[0] : raw.toUpperCase();
    }
    return senderMatchMode === "exact" ? raw.toUpperCase() : raw.toUpperCase();
  }, [senderPattern, senderMatchMode]);

  // Invalidate testResult whenever the template mutates — this was a v15.5.0 bug
  // where stale test results would linger.
  useEffect(() => {
    setTestResult(null);
    setUnrecResult(null);
  }, [spans, bankName, txType]);

  // Live compile for preview.
  const compiled = useMemo(() => {
    if (spans.length === 0 || !smsBody) return null;
    return compileTemplate({ smsBody, spans });
  }, [spans, smsBody]);

  // v15.10.0: preview comes directly from the tagged spans, NOT from the
  // compile result. Previously, if ANY field's tag failed round-trip
  // validation (e.g. tagging "Hi" as Amount), compileTemplate returned
  // { ok: false } and this memo returned `{}`, wiping the preview for
  // EVERY field including correctly-tagged ones. Users lost all visual
  // feedback the moment they mis-tagged one field. Now the preview is
  // driven by span offsets → compile errors show in the red warning card
  // below, and each field row keeps showing its tagged substring.
  const previewFields = useMemo(() => {
    const out: Partial<Record<TaggedField, string>> = {};
    for (const s of spans) {
      out[s.field] = smsBody.slice(s.start, s.end);
    }
    return out;
  }, [spans, smsBody]);

  const compileError = useMemo(() => {
    if (!compiled || compiled.ok) return null;
    return explainCompileError(compiled);
  }, [compiled]);

  // Duplicate detection — runs whenever bank name + tx type change.
  useEffect(() => {
    if (!bankName.trim()) {
      setDuplicateFound(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dup = await findDuplicateUserTemplate(
          bankName.trim(),
          txType,
          draft?.editingId ?? undefined,
        );
        if (!cancelled) {
          setDuplicateFound(dup ? { id: dup.id, label: dup.template_id ?? dup.bank_name } : null);
        }
      } catch {
        // Non-fatal — duplicate warning is purely advisory.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bankName, txType, draft?.editingId]);

  // Load all active payment modes once on mount.
  useEffect(() => {
    getPaymentModes(DEFAULT_USER_ID).then(setPaymentModes).catch(() => {});
  }, []);

  // Field row with per-field Clear button + per-field format helper.
  const renderFieldRow = (field: TaggedField) => {
    const palette = FIELD_COLORS[field];
    const isActive = activeField === field;
    const value = previewFields[field];
    const hasSpan = spans.some((s) => s.field === field);
    const isHelpOpen = expandedHelpField === field;
    const help = FIELD_FORMAT_HELP[field];
    return (
      <View key={field} className="mb-1.5">
        <View className="flex-row items-center">
          <Pressable
            onPress={() => setActiveField(isActive ? null : field)}
            className="flex-1 flex-row items-center py-2.5 px-3 rounded-lg"
            style={{
              backgroundColor: isActive ? palette.bg + "22" : "transparent",
              borderWidth: isActive ? 2 : 1,
              borderColor: isActive ? palette.bg : colors.border,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: palette.bg,
                marginRight: 10,
              }}
            />
            <Text
              className="text-sm font-semibold text-foreground flex-1"
            >
              {palette.label}
              {field === "amount" && (
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  {" · required"}
                </Text>
              )}
            </Text>
            <Text
              className="text-sm text-muted-foreground"
              numberOfLines={1}
              style={{ maxWidth: 160 }}
            >
              {value ?? (isActive ? "tap a word…" : "-")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setExpandedHelpField(isHelpOpen ? null : field)}
            hitSlop={8}
            className="ml-2 w-8 h-8 items-center justify-center"
            accessibilityLabel={`${palette.label} format help`}
          >
            <Ionicons
              name={isHelpOpen ? "information-circle" : "information-circle-outline"}
              size={20}
              color={isHelpOpen ? palette.bg : colors.textSecondary}
            />
          </Pressable>
          {hasSpan && (
            <Pressable
              onPress={() => setSpans((prev) => prev.filter((s) => s.field !== field))}
              hitSlop={8}
              className="ml-1 w-8 h-8 items-center justify-center"
              accessibilityLabel={`Clear ${palette.label} tag`}
            >
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
        {isHelpOpen && (
          <View
            className="mt-1.5 mx-3 p-2.5 rounded-lg"
            style={{ backgroundColor: palette.bg + "14" }}
          >
            <Text
              className="text-xs font-semibold mb-0.5"
              style={{ color: colors.text }}
            >
              {help.format}
            </Text>
            <Text className="text-label" style={{ color: colors.textSecondary, fontFamily: "monospace" }}>
              {help.examples}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const handleAutoTag = useCallback(() => {
    const guessed = autoTag(smsBody);
    if (guessed.length === 0) {
      alert(
        "Nothing to auto-tag",
        "Couldn't find obvious amount/account/date/ref in this SMS. Tap the fields manually.",
      );
      return;
    }
    // Merge: keep user-tagged fields, overlay autoTag for fields not yet tagged.
    const taggedFields = new Set(spans.map((s) => s.field));
    const additions = guessed.filter((g) => !taggedFields.has(g.field));
    if (additions.length === 0) {
      alert("Already tagged", "Auto-tag didn't find anything new. Clear a field first if you want to re-guess it.");
      return;
    }
    setSpans([...spans, ...additions]);
  }, [smsBody, spans, alert]);

  const handleTest = useCallback(() => {
    if (!compiled || !compiled.ok) {
      setTestResult({ ok: false });
      return;
    }
    const regexToUse = useManualRegex ? manualRegex : compiled.patternRegex;
    if (!regexToUse.trim()) {
      setTestResult({ ok: false });
      return;
    }
    // Validate manual regex
    if (useManualRegex) {
      try {
        new RegExp(regexToUse, "i");
      } catch (e) {
        alert("Invalid regex", e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const result = testTemplate(regexToUse, testSample.trim());
    if (result) setTestResult({ ok: true, extracted: result });
    else setTestResult({ ok: false });
  }, [compiled, testSample, useManualRegex, manualRegex, alert]);

  const handleTestUnrecognised = useCallback(async () => {
    if (!compiled || !compiled.ok || !bankName.trim()) return;
    const regexToUse = useManualRegex ? manualRegex : compiled.patternRegex;
    if (!regexToUse.trim()) return;
    // Validate manual regex
    if (useManualRegex) {
      try {
        new RegExp(regexToUse, "i");
      } catch (e) {
        alert("Invalid regex", e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setUnrecLoading(true);
    try {
      // v15.11.2: pass the sender claim so wallet/new-brand templates
      // find their SMSes. Bank name alone doesn't overlap with the
      // actual sender address for most wallets.
      const result = await testPatternAgainstUnrecognised(
        regexToUse,
        bankName.trim(),
        effectiveSenderPattern
          ? { mode: senderMatchMode, pattern: effectiveSenderPattern.toUpperCase() }
          : undefined,
      );
      setUnrecResult(result);
    } catch (e) {
      alert("Test failed", e instanceof Error ? e.message : String(e));
    } finally {
      setUnrecLoading(false);
    }
  }, [compiled, bankName, alert, effectiveSenderPattern, senderMatchMode, useManualRegex, manualRegex]);

  const handleSave = useCallback(async () => {
    if (saving) return;

    if (!effectiveSenderPattern) {
      alert(
        "Sender ID required",
        "Paste the SMS sender ID (e.g. VM-HDFCBK-S, AD-MYTNEU-T) so Arth knows which incoming SMSes this template should handle.",
      );
      return;
    }
    if (!bankName.trim()) {
      alert("Bank / Wallet name required", "Give this template a short name - Arth will label matching expenses with it.");
      return;
    }
    if (spans.length === 0) {
      alert("Tag at least one field", "Tap the Amount field and then the amount in the SMS.");
      return;
    }
    if (!spans.some((s) => s.field === "amount")) {
      alert("Amount is required", "Every template needs the amount tagged - otherwise Arth can't tell what the transaction is worth.");
      return;
    }
    // v15.13.0: validate manual regex if in manual mode — compile from spans
    // is NOT required when the user has a valid manual regex.
    if (useManualRegex) {
      if (!manualRegex.trim()) {
        alert("Manual regex required", "Please enter a regex pattern when in manual edit mode.");
        return;
      }
      try {
        new RegExp(manualRegex, "i");
      } catch (e) {
        alert("Invalid regex", e instanceof Error ? e.message : String(e));
        return;
      }
    } else if (!compiled || !compiled.ok) {
      alert("Can't save yet", explainCompileError(compiled!));
      return;
    }
    if (duplicateFound) {
      alert(
        "You already have a template for this",
        `"${duplicateFound.label}" already handles ${bankName.trim()} ${txType} SMS. If you save a second one, both will be tried - which may slow matching. Consider editing the existing template instead.`,
        [
          { text: "Save Anyway", onPress: () => void doSave() },
          {
            text: "Edit Existing",
            onPress: () => {
              clearDraft();
              router.replace(`/settings/sms-templates/${duplicateFound.id}` as never);
            },
          },
          { text: "Cancel", style: "cancel" },
        ],
      );
      return;
    }
    await doSave();

    async function doSave() {
      setSaving(true);
      savingRef.current = true;
      try {
        const regexToSave = useManualRegex ? manualRegex : undefined;
        if (draft?.editingId) {
          await updateUserTemplate(draft.editingId, {
            bankName: bankName.trim(),
            txType,
            sampleSms: smsBody,
            spans,
            label: label.trim() || undefined,
            senderPattern: effectiveSenderPattern,
            senderMatchMode,
            patternRegex: regexToSave,
            defaultPaymentModeId,
          });
        } else {
          await createUserTemplate({
            bankName: bankName.trim(),
            txType,
            sampleSms: smsBody,
            spans,
            label: label.trim() || undefined,
            createdFromSmsId: draft?.createdFromSmsId ?? undefined,
            senderPattern: effectiveSenderPattern,
            senderMatchMode,
            patternRegex: regexToSave,
            defaultPaymentModeId,
          });
        }
        // v15.11.2: navigate FIRST, clear draft SECOND.
        //
        // Order matters: the tag screen has a useEffect that redirects to
        // /new when the draft's smsBody goes empty. If we clearDraft()
        // before navigating, any intermediate re-render of tag.tsx during
        // the stack pop (back → replace → mount sequence) fires that
        // redirect, and the user lands on /new instead of the list.
        //
        // By navigating first, the tag screen unmounts before it can re-
        // run the useEffect. clearDraft then runs safely; the next time
        // the user enters a template flow, draft starts fresh.
        //
        // dismissAll() is intentionally NOT used here — dismissAll only
        // dismisses modal presentations in Expo Router, not regular stack
        // routes. Use replace() which atomically swaps the top of the
        // stack.
        router.replace("/settings/sms-templates" as never);
        clearDraft();
      } catch (e) {
        alert("Couldn't save template", e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }
  }, [saving, bankName, spans, compiled, smsBody, txType, label, draft, router, alert, duplicateFound, effectiveSenderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId]);

  if (!smsBody) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      </ScreenContainer>
    );
  }

  const exactBankMatch = BANK_SUGGESTIONS.some(
    (b) => b.toLowerCase() === bankName.trim().toLowerCase(),
  );

  return (
    <ScreenContainer padTop={false}>
      {/* Sticky active-field banner — replaces the "tip" that used to hide at the bottom of card 1. */}
      {activeField && (
        <View
          style={{
            backgroundColor: FIELD_COLORS[activeField].bg,
            paddingHorizontal: 16,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: FIELD_COLORS[activeField].text,
              marginRight: 8,
            }}
          />
          <Text
            style={{
              color: FIELD_COLORS[activeField].text,
              fontSize: 13,
              fontWeight: "600",
              flex: 1,
            }}
          >
            Tap the {FIELD_COLORS[activeField].label.toLowerCase()} in the SMS below
          </Text>
          <Pressable onPress={() => setActiveField(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={FIELD_COLORS[activeField].text} />
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 320 }}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => {
          // Close the bank dropdown on scroll — outside-tap proxy.
          if (showBankPicker) setShowBankPicker(false);
          Keyboard.dismiss();
        }}
      >
        {/* Step indicator */}
        <View className="flex-row items-center justify-center mb-3">
          {[1, 2, 3].map((n, i) => (
            <View key={n} className="flex-row items-center">
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: accentColor,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>{n}</Text>
              </View>
              {i < 2 && (
                <View
                  style={{
                    width: 28,
                    height: 2,
                    marginHorizontal: 4,
                    backgroundColor: colors.border,
                  }}
                />
              )}
            </View>
          ))}
        </View>

        {/* Card 1: Fields */}
        <Card className="mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              1. Tag the fields
            </Text>
            <Pressable
              onPress={handleAutoTag}
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{ backgroundColor: accentColor + "18" }}
            >
              <Ionicons name="sparkles-outline" size={14} color={accentColor} />
              <Text style={{ color: accentColor, fontSize: 12, fontWeight: "600", marginLeft: 4 }}>
                Guess it for me
              </Text>
            </Pressable>
          </View>
          {FIELDS.map(renderFieldRow)}
          {compileError && spans.length > 0 && (
            <View
              className="mt-2 p-2.5 rounded-lg flex-row items-start"
              style={{ backgroundColor: "#EF444415" }}
            >
              <Ionicons name="warning-outline" size={14} color="#EF4444" style={{ marginTop: 2 }} />
              <Text className="text-xs ml-2 flex-1" style={{ color: "#EF4444" }}>
                {compileError}
              </Text>
            </View>
          )}
        </Card>

        {/* Card 2: SMS with tappable tokens */}
        <Card className="mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            2. The SMS
          </Text>
          <Text className="text-label text-faint-foreground mb-3">
            Tap a word to tag. Tap a tagged word to untag it. Long-press to pick just part of a word (e.g. "1,500" out of "Rs.1,500").
          </Text>
          <TokenTagger
            smsBody={smsBody}
            spans={spans}
            activeField={activeField}
            onSpanChange={setSpans}
          />
        </Card>

        {/* Card 3: Metadata (tx type + bank + label) */}
        <Card className="mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            3. Details
          </Text>

          <Text className="text-xs text-faint-foreground mb-1.5">Transaction type</Text>
          <View className="flex-row mb-3" style={{ gap: 8 }}>
            {(["debit", "credit", "refund"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTxType(t)}
                className="flex-1 items-center py-2.5 rounded-lg"
                style={{
                  backgroundColor: txType === t ? accentColor : "transparent",
                  borderWidth: 1,
                  borderColor: txType === t ? accentColor : colors.border,
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: txType === t ? "#FFFFFF" : colors.text,
                    textTransform: "capitalize",
                  }}
                >
                  {t === "debit" ? "Expense" : t}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* v15.11.0: sender ID routing. The template matches future SMSes
              based on the sender (header of the message), not the bank name.
              This is what makes wallets + unknown brands work. */}
          <Text className="text-xs text-faint-foreground mb-1.5">Sender ID</Text>
          <Input
            value={senderPattern}
            onChangeText={setSenderPattern}
            placeholder="e.g. VM-MYTNEU-S"
            autoCapitalize="characters"
          />
          <Text className="text-label text-faint-foreground mt-1 mb-2">
            Copy the sender shown above the SMS in your messages app. Arth will
            match future SMSes from the same sender.
          </Text>

          <Text className="text-xs text-faint-foreground mb-1.5">Match mode</Text>
          <View className="flex-row mb-2" style={{ gap: 8 }}>
            {(["code", "exact", "contains"] as const).map((m) => {
              const isActive = senderMatchMode === m;
              const labels: Record<SenderMatchMode, string> = {
                code: "Code",
                exact: "Exact",
                contains: "Contains",
              };
              return (
                <Pressable
                  key={m}
                  onPress={() => setSenderMatchMode(m)}
                  className="flex-1 items-center py-2.5 rounded-lg"
                  style={{
                    backgroundColor: isActive ? accentColor : "transparent",
                    borderWidth: 1,
                    borderColor: isActive ? accentColor : colors.border,
                  }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: isActive ? "#FFFFFF" : colors.text }}
                  >
                    {labels[m]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {effectiveSenderPattern && (
            <View
              className="mb-3 p-2.5 rounded-lg"
              style={{ backgroundColor: accentColor + "14" }}
            >
              <Text className="text-label" style={{ color: colors.text }}>
                {senderMatchMode === "code" &&
                  `Will match any sender with code "${effectiveSenderPattern}" (e.g. VM-${effectiveSenderPattern}-S, AD-${effectiveSenderPattern}-T).`}
                {senderMatchMode === "exact" &&
                  `Will match only the exact sender "${effectiveSenderPattern}". Stricter - breaks if the sender prefix changes.`}
                {senderMatchMode === "contains" &&
                  `Will match any sender containing "${effectiveSenderPattern}". Loosest - may over-match.`}
              </Text>
            </View>
          )}

          <Text className="text-xs text-faint-foreground mb-1.5">Bank or Wallet Name</Text>
          <Input
            value={bankName}
            onChangeText={(v) => {
              setBankName(v);
              setShowBankPicker(true);
            }}
            onFocus={() => setShowBankPicker(true)}
            onBlur={() => {
              // Delay so suggestion tap lands before the dropdown closes.
              setTimeout(() => setShowBankPicker(false), 150);
            }}
            placeholder="e.g. Kotak Mahindra Bank"
          />
          {showBankPicker && bankName.trim().length > 0 && !exactBankMatch && (
            <View
              className="mt-2 rounded-lg"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              {BANK_SUGGESTIONS.filter((b) =>
                b.toLowerCase().includes(bankName.trim().toLowerCase()),
              )
                .slice(0, 5)
                .map((b, i) => (
                  <Pressable
                    key={b}
                    onPress={() => {
                      setBankName(b);
                      setShowBankPicker(false);
                      Keyboard.dismiss();
                    }}
                    className="py-2.5 px-3"
                    style={{
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text className="text-sm text-foreground">
                      {b}
                    </Text>
                  </Pressable>
                ))}
            </View>
          )}

          {duplicateFound && (
            <View
              className="mt-3 p-2.5 rounded-lg flex-row items-start"
              style={{ backgroundColor: "#F59E0B18" }}
            >
              <Ionicons name="information-circle-outline" size={14} color="#F59E0B" style={{ marginTop: 2 }} />
              <Text className="text-xs ml-2 flex-1" style={{ color: colors.text }}>
                You already have a "{duplicateFound.label}" template for this bank + type. Tap Save to add this as a second format, or tap the template in the list to edit it.
              </Text>
            </View>
          )}

          <Input
            containerClassName="mt-3"
            label="Label (optional)"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Kotak UPI Debit"
          />

          <Text className="text-xs text-faint-foreground mt-3 mb-1.5">Default payment mode (optional)</Text>
          <Text className="text-label text-faint-foreground mb-2">
            Applied when the SMS doesn't carry payment mode info. Smart Rules override this.
          </Text>
          {/* Payment mode dropdown */}
          <Pressable
            onPress={() => setShowPaymentModePicker(!showPaymentModePicker)}
            className="flex-row items-center justify-between py-2.5 px-3 rounded-lg"
            style={{ borderWidth: 1, borderColor: showPaymentModePicker ? accentColor : colors.border }}
          >
            <Text
              className="text-sm"
              style={{ color: defaultPaymentModeId ? colors.text : colors.textSecondary }}
            >
              {defaultPaymentModeId
                ? (paymentModes.find((m) => m.id === defaultPaymentModeId)?.name ?? "Unknown")
                : "None"}
            </Text>
            <Ionicons
              name={showPaymentModePicker ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
          {showPaymentModePicker && (
            <View
              className="mt-1 rounded-lg"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              {/* None option */}
              <Pressable
                onPress={() => { setDefaultPaymentModeId(null); setShowPaymentModePicker(false); }}
                className="flex-row items-center justify-between py-2.5 px-3"
                style={{ borderBottomWidth: paymentModes.length > 0 ? 1 : 0, borderColor: colors.border }}
              >
                <Text className="text-sm text-muted-foreground">None</Text>
                {defaultPaymentModeId === null && (
                  <Ionicons name="checkmark" size={16} color={accentColor} />
                )}
              </Pressable>
              {paymentModes.map((mode, i) => (
                <Pressable
                  key={mode.id}
                  onPress={() => { setDefaultPaymentModeId(mode.id); setShowPaymentModePicker(false); }}
                  className="flex-row items-center justify-between py-2.5 px-3"
                  style={{ borderTopWidth: i === 0 ? 0 : 1, borderColor: colors.border }}
                >
                  <Text className="text-sm text-foreground">{mode.name}</Text>
                  {defaultPaymentModeId === mode.id && (
                    <Ionicons name="checkmark" size={16} color={accentColor} />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        {/* Card 4: Regex preview (collapsible) */}
        {compiled && compiled.ok && (
          <Card className="mb-4">
            <Pressable
              onPress={() => setShowRegexPreview(!showRegexPreview)}
              className="flex-row items-center"
            >
              <Ionicons
                name={showRegexPreview ? "chevron-down" : "chevron-forward"}
                size={14}
                color={colors.textSecondary}
              />
              <Text className="text-xs font-semibold text-muted-foreground ml-2 uppercase tracking-wider">
                Pattern Preview (advanced)
              </Text>
            </Pressable>
            {showRegexPreview && (
              <View className="mt-2">
                <View className="flex-row items-center mb-2">
                  <Pressable
                    onPress={() => {
                      const regexToCopy = useManualRegex ? manualRegex : compiled.patternRegex;
                      Alert.alert("Copied", "Regex copied to clipboard");
                    }}
                    className="flex-row items-center px-2 py-1 rounded"
                    style={{ backgroundColor: accent[500] + "20" }}
                  >
                    <Ionicons name="copy-outline" size={14} color={accent[500]} />
                    <Text className="text-xs ml-1" style={{ color: accent[500] }}>Copy</Text>
                  </Pressable>
                  <View className="flex-1" />
                  <Pressable
                    onPress={() => {
                      setUseManualRegex(!useManualRegex);
                      if (!useManualRegex) {
                        setManualRegex(compiled.patternRegex);
                      }
                    }}
                    className="flex-row items-center px-2 py-1 rounded"
                    style={{ backgroundColor: useManualRegex ? accent[500] + "20" : colors.border }}
                  >
                    <Ionicons 
                      name={useManualRegex ? "checkmark-circle" : "radio-button-off"} 
                      size={14} 
                      color={useManualRegex ? accent[500] : colors.textSecondary} 
                    />
                    <Text className="text-xs ml-1" style={{ color: useManualRegex ? accent[500] : colors.textSecondary }}>
                      Manual Edit
                    </Text>
                  </Pressable>
                </View>
                {useManualRegex ? (
                  <TextInput
                    value={manualRegex}
                    onChangeText={setManualRegex}
                    multiline
                    textAlignVertical="top"
                    placeholder="Enter custom regex pattern..."
                    placeholderTextColor={colors.textSecondary}
                    style={{
                      minHeight: 120,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      padding: 12,
                      color: colors.text,
                      fontFamily: "monospace",
                      fontSize: 12,
                      backgroundColor: colors.background,
                    }}
                  />
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    <Text
                      className="text-xs p-2"
                      style={{
                        color: colors.text,
                        fontFamily: "monospace",
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 6,
                      }}
                      selectable
                    >
                      {compiled.patternRegex}
                    </Text>
                  </ScrollView>
                )}
              </View>
            )}
          </Card>
        )}

        {/* Card 5: Test */}
        <Card className="mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Test the template (optional)
          </Text>
          <Text className="text-label text-faint-foreground mb-2">
            Paste another SMS from the same bank to verify the template matches it too.
          </Text>
          <TextInput
            multiline
            value={testSample}
            onChangeText={(v) => {
              setTestSample(v);
              setTestResult(null);
            }}
            placeholder="Paste a second sample…"
            placeholderTextColor={colors.textSecondary}
            style={{
              minHeight: 80,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              padding: 10,
              fontSize: 13,
              color: colors.text,
              backgroundColor: colors.background,
              textAlignVertical: "top",
            }}
          />
          <View className="mt-2 flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Test this SMS"
                onPress={handleTest}
                variant="secondary"
                disabled={testSample.trim().length < 10 || !compiled || !compiled.ok}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={unrecLoading ? "Scanning…" : "Test against recent"}
                onPress={handleTestUnrecognised}
                variant="secondary"
                disabled={!compiled || !compiled.ok || !bankName.trim() || unrecLoading}
              />
            </View>
          </View>
          {testResult && (
            <View className="mt-3">
              {testResult.ok ? (
                <>
                  <View className="flex-row items-center mb-1">
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    <Text className="text-xs font-semibold ml-1" style={{ color: "#10B981" }}>
                      Matched
                    </Text>
                  </View>
                  {Object.entries(testResult.extracted).map(([field, value]) => (
                    <Text key={field} className="text-xs text-muted-foreground ml-5">
                      {field}: {value}
                    </Text>
                  ))}
                </>
              ) : (
                <View className="flex-row items-center">
                  <Ionicons name="close-circle" size={16} color="#EF4444" />
                  <Text className="text-xs font-semibold ml-1" style={{ color: "#EF4444" }}>
                    No match. Try tagging just the number part (long-press a token for char selection).
                  </Text>
                </View>
              )}
            </View>
          )}
          {unrecResult && (
            <View className="mt-3 p-2.5 rounded-lg" style={{ backgroundColor: accentColor + "10" }}>
              <View className="flex-row items-center">
                <Ionicons
                  name={unrecResult.matched > 0 ? "checkmark-circle" : "information-circle-outline"}
                  size={16}
                  color={accentColor}
                />
                <Text className="text-xs font-semibold ml-1" style={{ color: accentColor }}>
                  Matches {unrecResult.matched} of {unrecResult.total} recent unrecognised SMS
                </Text>
              </View>
              {unrecResult.samples.length > 0 && (
                <View className="mt-1.5">
                  {unrecResult.samples.map((s, i) => (
                    <Text
                      key={i}
                      className="text-label mt-0.5 ml-5"
                      style={{ color: colors.textSecondary }}
                      numberOfLines={1}
                    >
                      • {s}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </Card>

        <Button
          title={saving ? "Saving…" : draft?.editingId ? "Save Changes" : "Save Template"}
          onPress={handleSave}
          disabled={saving || (!useManualRegex && (!compiled || !compiled.ok))}
          loading={saving}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
