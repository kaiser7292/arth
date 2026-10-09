import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { View, TextInput, ScrollView, Pressable, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LoadingState, ScreenContainer, Text } from "@/components/ui";
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
  deriveSpansFromRegex,
  explainCompileError,
  type MatchStyle,
  type TaggedField,
  type TaggedSpan,
  type WordRules,
  type WordState,
} from "@/services/sms/template-compiler";
import {
  applyTemplateToBacklog,
  findBacklogMatches,
  getBacklogDays,
  type BacklogMatch,
} from "@/services/sms/template-backlog";
import { TemplatePreviewSheet } from "@/components/sms-templates/TemplatePreviewSheet";
import { ExamplePickerSheet } from "@/components/sms-templates/ExamplePickerSheet";
import {
  getDraft,
  updateDraft,
  clearDraft,
} from "@/services/sms/template-draft-store";
import {
  createUserTemplate,
  updateUserTemplate,
  findDuplicateUserTemplate,
  listUnrecognisedSms,
  type UserTxType,
  type SenderMatchMode,
  type TemplateSample,
} from "@/services/sms/user-sms-templates";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

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

const FIELDS: TaggedField[] = ["amount", "account", "merchant", "date", "balance", "ref", "counterparty", "other_account"];

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
  counterparty: {
    format: "Who sent or received the money — a person or business name",
    examples: "SOURAVBAID   ·   RAHUL VERMA   ·   ACME PVT LTD",
  },
  other_account: {
    format: "Last digits of the other account in a transfer",
    examples: "xxxxxxxxxx0006   ·   **1234   ·   1234",
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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

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
  // Flexible matching: how strict, user word overrides, and extra examples.
  const [matchStyle, setMatchStyle] = useState<MatchStyle>(draft?.matchStyle ?? "flexible");
  const [wordRules, setWordRules] = useState<WordRules>(draft?.wordRules ?? { required: [], optional: [] });
  const [extraSamples, setExtraSamples] = useState<TemplateSample[]>(draft?.extraSamples ?? []);
  // Which unread messages from this sender the template reads (live, and the preview on Save).
  const [coverage, setCoverage] = useState<{ total: number; matches: BacklogMatch[] } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [examplePickerOpen, setExamplePickerOpen] = useState(false);
  const [exampleCandidates, setExampleCandidates] = useState<{ id: string; body: string }[]>([]);
  const backlogDays = useMemo(() => getBacklogDays(), []);
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
      router.replace("/settings/sms-templates/new");
    }
  }, [smsBody, router]);

  // Persist changes to draft store so Back re-entry doesn't lose them.
  useEffect(() => {
    updateDraft({ spans, bankName, txType, label, senderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId, matchStyle, wordRules, extraSamples });
  }, [spans, bankName, txType, label, senderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId, matchStyle, wordRules, extraSamples]);

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
  }, [spans, bankName, txType, matchStyle, wordRules, extraSamples]);

  // Live compile for preview.
  const compiled = useMemo(() => {
    if (spans.length === 0 || !smsBody) return null;
    return compileTemplate({
      smsBody,
      spans,
      style: matchStyle,
      wordRules,
      extraSamples: extraSamples.map((x) => ({ smsBody: x.body, spans: x.spans })),
    });
  }, [spans, smsBody, matchStyle, wordRules, extraSamples]);

  // Word states drive the outlined (must appear) / dashed (can change) words. Kept on errors so
  // a "too loose" template can be fixed by tapping a word.
  const wordStates: WordState[] | undefined =
    matchStyle === "flexible" && compiled ? compiled.wordStates : undefined;

  const toggleWord = useCallback((ws: WordState) => {
    const w = ws.word;
    setWordRules((r) => {
      const required = r.required.filter((x) => x !== w);
      const optional = r.optional.filter((x) => x !== w);
      if (ws.state === "required") return { required, optional }; // back to automatic
      if (ws.state === "free") return { required: [...required, w], optional };
      return { required, optional: [...optional, w] }; // automatic / shared → can change
    });
  }, []);

  // The pattern actually in use (manual override or compiled).
  const activePattern = useManualRegex ? manualRegex : compiled && compiled.ok ? compiled.patternRegex : "";

  // Live "Reads X of Y" against this sender's unread messages.
  useEffect(() => {
    if (!activePattern.trim() || !effectiveSenderPattern) {
      setCoverage(null);
      return;
    }
    let cancelled = false;
    setCoverageLoading(true);
    const timer = setTimeout(() => {
      findBacklogMatches({
        id: draft?.editingId ?? undefined,
        patternRegex: activePattern,
        txType,
        bankName: bankName.trim(),
        senderMatchMode,
        senderPattern: effectiveSenderPattern,
      })
        .then((r) => {
          if (!cancelled) setCoverage(r);
        })
        .catch(() => {
          if (!cancelled) setCoverage(null);
        })
        .finally(() => {
          if (!cancelled) setCoverageLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePattern, effectiveSenderPattern, senderMatchMode, txType, bankName, draft?.editingId]);

  // "Add another example": the sender's other unread messages.
  const openExamplePicker = useCallback(async () => {
    try {
      const rows = await listUnrecognisedSms(200);
      const used = new Set([smsBody, ...extraSamples.map((x) => x.body)]);
      const code = effectiveSenderPattern.toUpperCase();
      setExampleCandidates(
        rows
          .filter((r) => !used.has(r.body))
          .filter((r) => !code || r.address.toUpperCase().includes(code))
          .slice(0, 30)
          .map((r) => ({ id: r.id, body: r.body })),
      );
    } catch {
      setExampleCandidates([]);
    }
    setExamplePickerOpen(true);
  }, [smsBody, extraSamples, effectiveSenderPattern]);

  const addExample = useCallback(
    (body: string) => {
      setExamplePickerOpen(false);
      // Pre-tag with what the template reads now, else Arth's best guess; the user fixes the rest.
      const fromTemplate = activePattern ? deriveSpansFromRegex(activePattern, body) : null;
      setExtraSamples((prev) => [...prev, { body, spans: fromTemplate ?? autoTag(body) }]);
      setMatchStyle("flexible"); // learning from several examples is a flexible-matching feature
      setActiveField(null);
    },
    [activePattern],
  );

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
    // Show what it will read before saving; the sheet's button continues below.
    setExcluded(new Set());
    setPreviewOpen(true);
  }, [saving, bankName, spans, compiled, effectiveSenderPattern, useManualRegex, manualRegex, alert]);

  const confirmSave = useCallback(async () => {
    if (saving) return;
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
              router.replace(`/settings/sms-templates/${duplicateFound.id}`);
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
        let saved;
        if (draft?.editingId) {
          saved = await updateUserTemplate(draft.editingId, {
            bankName: bankName.trim(),
            txType,
            sampleSms: smsBody,
            spans,
            label: label.trim() || undefined,
            senderPattern: effectiveSenderPattern,
            senderMatchMode,
            patternRegex: regexToSave,
            defaultPaymentModeId,
            matchStyle,
            wordRules,
            extraSamples,
          });
        } else {
          saved = await createUserTemplate({
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
            matchStyle,
            wordRules,
            extraSamples,
          });
        }
        setPreviewOpen(false);
        const toRead = (coverage?.matches ?? []).filter((m) => !excluded.has(m.id)).length;
        if (toRead > 0) {
          const tpl = {
            id: saved.id,
            patternRegex: saved.pattern_regex,
            txType: saved.tx_type,
            bankName: saved.bank_name,
            senderMatchMode: saved.sender_match_mode,
            senderPattern: saved.sender_pattern,
          };
          const finish = () => {
            router.replace("/settings/sms-templates");
            clearDraft();
          };
          alert(
            `Read ${toRead} past message${toRead === 1 ? "" : "s"} now?`,
            "They were sitting in Unrecognised. They'll go to your review queue, the same as new ones.",
            [
              { text: "Not now", style: "cancel", onPress: finish },
              {
                text: "Read them",
                onPress: async () => {
                  try {
                    const created = await applyTemplateToBacklog(tpl, [...excluded]);
                    alert(
                      created > 0 ? `${created} added to your review queue` : "Nothing new to add",
                      created > 0 ? "Review them in Catch Up or the review queue." : "They may already have been read.",
                      [{ text: "OK", onPress: finish }],
                    );
                  } catch (e) {
                    alert("Couldn't read them", e instanceof Error ? e.message : String(e), [{ text: "OK", onPress: finish }]);
                  }
                },
              },
            ],
          );
          return;
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
        router.replace("/settings/sms-templates");
        clearDraft();
      } catch (e) {
        alert("Couldn't save template", e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }
  }, [saving, bankName, spans, smsBody, txType, label, draft, router, alert, duplicateFound, effectiveSenderPattern, senderMatchMode, useManualRegex, manualRegex, defaultPaymentModeId, matchStyle, wordRules, extraSamples, coverage, excluded]);

  if (!smsBody) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState />
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
              <Ionicons name="warning-outline" size={14} color={theme.danger} style={{ marginTop: 2 }} />
              <Text className="text-xs ml-2 flex-1" style={{ color: theme.danger }}>
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
          <Text className="text-xs text-faint-foreground mb-1.5">Match</Text>
          <View className="flex-row mb-1.5" style={{ gap: 8 }}>
            {(["flexible", "exact"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  if (m === "exact" && extraSamples.length > 0) {
                    alert("Remove the extra examples first", "Exact matching uses one example. Remove the others to switch.");
                    return;
                  }
                  setMatchStyle(m);
                }}
                className="flex-1 items-center py-2 rounded-lg"
                style={{
                  backgroundColor: matchStyle === m ? accentColor : "transparent",
                  borderWidth: 1,
                  borderColor: matchStyle === m ? accentColor : colors.border,
                }}
              >
                <Text className="text-sm font-semibold" style={{ color: matchStyle === m ? "#FFFFFF" : colors.text }}>
                  {m === "flexible" ? "Flexible" : "Exact"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-label text-faint-foreground mb-3">
            {matchStyle === "flexible"
              ? "Only the outlined words must appear; dashed words can change. With no field selected, tap a word to switch it."
              : "Every word between the fields must match exactly. A changed word stops it reading the message."}
          </Text>
          <Text className="text-label text-faint-foreground mb-3">
            Tap a word to tag. Tap a tagged word to untag it. Long-press to pick just part of a word (e.g. "1,500" out of "Rs.1,500").
          </Text>
          <TokenTagger
            smsBody={smsBody}
            spans={spans}
            activeField={activeField}
            onSpanChange={setSpans}
            wordStates={wordStates}
            onToggleWord={toggleWord}
          />
        </Card>

        {/* More examples of the same format */}
        {extraSamples.map((ex, i) => (
          <Card key={`ex-${i}`} className="mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Example {i + 2}
              </Text>
              <Pressable
                onPress={() => setExtraSamples((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={8}
                accessibilityLabel={`Remove example ${i + 2}`}
              >
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text className="text-label text-faint-foreground mb-3">
              Tag the same fields here. Words both messages share are kept; the rest can change.
            </Text>
            <TokenTagger
              smsBody={ex.body}
              spans={ex.spans}
              activeField={activeField}
              onSpanChange={(next) =>
                setExtraSamples((prev) => prev.map((x, j) => (j === i ? { ...x, spans: next } : x)))
              }
            />
          </Card>
        ))}
        {!useManualRegex && extraSamples.length < 2 && (
          <Pressable
            onPress={() => void openExamplePicker()}
            className="flex-row items-center justify-center py-3 mb-4 rounded-xl border border-dashed border-border"
            accessibilityRole="button"
          >
            <Ionicons name="add-circle-outline" size={18} color={accentColor} />
            <Text className="ml-2 text-sm font-medium" style={{ color: accentColor }}>
              Add another example
            </Text>
          </Pressable>
        )}

        {/* Live: what it reads among this sender's unread messages */}
        <Pressable
          onPress={() => coverage && setPreviewOpen(true)}
          className="mb-4 p-3 rounded-xl flex-row items-center"
          style={{ backgroundColor: coverage && coverage.matches.length > 0 ? theme.alpha("success", 0.12) : theme.alpha("foreground", 0.05) }}
          accessibilityRole="button"
        >
          <Ionicons
            name={coverage && coverage.matches.length > 0 ? "checkmark-circle-outline" : "mail-unread-outline"}
            size={18}
            color={coverage && coverage.matches.length > 0 ? theme.success : colors.textSecondary}
          />
          <Text className="text-xs ml-2 flex-1" style={{ color: colors.text }}>
            {!effectiveSenderPattern
              ? "Add the sender ID below to see which unread messages this reads."
              : coverageLoading && !coverage
                ? "Checking your unread messages…"
                : coverage
                  ? `Reads ${coverage.matches.length} of ${coverage.total} unread from ${effectiveSenderPattern} in the last ${backlogDays} days`
                  : "Finish tagging to see which unread messages this reads."}
          </Text>
          {coverage && coverage.matches.length > 0 && (
            <Text className="text-xs font-semibold" style={{ color: theme.success }}>
              See list
            </Text>
          )}
        </Pressable>

        {/* Card 3: Metadata (tx type + bank + label) */}
        <Card className="mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            3. Details
          </Text>

          <Text className="text-xs text-faint-foreground mb-1.5">Transaction type</Text>
          <View className="flex-row mb-3" style={{ gap: 8 }}>
            {(["auto", "debit", "credit", "refund"] as const).map((t) => (
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
                  {t === "debit" ? "Expense" : t === "auto" ? "Auto" : t}
                </Text>
              </Pressable>
            ))}
          </View>
          {txType === "auto" && (
            <Text className="text-label text-faint-foreground -mt-1.5 mb-3">
              Arth reads money in or out from the words — “credited”, “debited”, “refund” — so one template covers both.
            </Text>
          )}

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
              <Ionicons name="information-circle-outline" size={14} color={theme.warning} style={{ marginTop: 2 }} />
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
                    style={{ backgroundColor: theme.alpha("primary", 0.13) }}
                  >
                    <Ionicons name="copy-outline" size={14} color={theme.primary} />
                    <Text className="text-xs ml-1" style={{ color: theme.primary }}>Copy</Text>
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
                    style={{ backgroundColor: useManualRegex ? theme.alpha("primary", 0.13) : colors.border }}
                  >
                    <Ionicons 
                      name={useManualRegex ? "checkmark-circle" : "radio-button-off"} 
                      size={14} 
                      color={useManualRegex ? theme.primary : colors.textSecondary} 
                    />
                    <Text className="text-xs ml-1" style={{ color: useManualRegex ? theme.primary : colors.textSecondary }}>
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
          <View className="mt-2">
            <Button
              title="Test this SMS"
              onPress={handleTest}
              variant="secondary"
              disabled={testSample.trim().length < 10 || !compiled || !compiled.ok}
            />
          </View>
          {testResult && (
            <View className="mt-3">
              {testResult.ok ? (
                <>
                  <View className="flex-row items-center mb-1">
                    <Ionicons name="checkmark-circle" size={16} color={theme.success} />
                    <Text className="text-xs font-semibold ml-1" style={{ color: theme.success }}>
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
                  <Ionicons name="close-circle" size={16} color={theme.danger} />
                  <Text className="text-xs font-semibold ml-1" style={{ color: theme.danger }}>
                    No match. Try tagging just the number part (long-press a token for char selection).
                  </Text>
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
      <TemplatePreviewSheet
        visible={previewOpen}
        loading={coverageLoading && !coverage}
        total={coverage?.total ?? 0}
        days={backlogDays}
        sender={effectiveSenderPattern}
        matches={coverage?.matches ?? []}
        excluded={excluded}
        onToggle={(id) =>
          setExcluded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        saving={saving}
        saveTitle={draft?.editingId ? "Save changes" : "Save template"}
        onSave={() => void confirmSave()}
        onClose={() => setPreviewOpen(false)}
      />
      <ExamplePickerSheet
        visible={examplePickerOpen}
        candidates={exampleCandidates}
        onPick={addExample}
        onClose={() => setExamplePickerOpen(false)}
      />
    </ScreenContainer>
  );
}
