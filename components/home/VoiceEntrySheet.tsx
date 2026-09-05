import { useEffect, useRef, useState } from "react";

import { Text } from "@/components/ui";
import { Animated, Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { DEFAULT_USER_ID } from "@/constants/app";
import { parseVoiceInput } from "@/utils/voice-parser";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { getPaymentModes } from "@/services/payment-mode";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import { getPersonsWithBalances } from "@/services/hisaab";
import { createTransfer } from "@/services/account-transfer";
import { bumpDataVersion } from "@/services/settings";
import { getVoiceSettings } from "@/services/voice-settings";
import type { VoiceSettings } from "@/services/voice-settings";
import { useTheme } from "@/hooks/use-theme";

type VoiceState = "idle" | "listening" | "speaking";
type SessionType = "expense" | "transfer";
type PendingField =
  | "amount" | "merchant" | "category" | "paymentMode" | "account" | "split"
  | "transferAmount" | "transferFrom" | "transferTo" | "transferConfirm";

interface VoiceSession {
  sessionType: SessionType;
  confirming: boolean;
  amount?: number;
  merchant?: string;
  description?: string;
  paymentModeId?: string;
  accountId?: string;
  categoryId?: string;
  dateIso?: string;
  splitPersonId?: string;
  transferFromAccountId?: string;
  transferToAccountId?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Matching helpers ─────────────────────────────────────────────────────────

function words3(t: string): string[] {
  return t.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
}

function wordMatchesName(word: string, name: string): boolean {
  const n = name.toLowerCase();
  return n.length > 2 && (n.includes(word) || word.includes(n));
}

function matchPaymentMode(text: string, modes: PaymentMode[]): PaymentMode | undefined {
  const t = text.toLowerCase().trim();
  return modes.find((m) => {
    const n = m.name.toLowerCase();
    return n.length > 1 && (n === t || n.includes(t) || t.includes(n));
  });
}

// Returns all accounts whose bank/label matches the text (for disambiguation)
function findAllMatchingAccounts(text: string, accounts: FinancialAccount[]): FinancialAccount[] {
  const t = text.toLowerCase().trim();
  const wds = words3(t);

  // Digit match is specific — return only those
  const byDigits = accounts.filter((a) => {
    if (!a.account_identifier || a.account_identifier.length < 3) return false;
    return t.includes(a.account_identifier.slice(-4)) || t.includes(a.account_identifier.slice(-3));
  });
  if (byDigits.length > 0) return byDigits;

  return accounts.filter((a) => {
    const bank = (a.bank_name ?? "").toLowerCase();
    const label = (a.account_label ?? "").toLowerCase();
    return wds.some((w) => wordMatchesName(w, bank) || wordMatchesName(w, label));
  });
}

// Digit-only match within a known candidate set (disambiguation step)
function matchByDigits(text: string, candidates: FinancialAccount[]): FinancialAccount | undefined {
  const t = text.toLowerCase().replace(/\s+/g, "");
  return candidates.find((a) => {
    const id = a.account_identifier ?? "";
    return id.length >= 3 && (t.includes(id.slice(-4)) || t.includes(id.slice(-3)));
  });
}

function matchCategory(text: string, cats: Category[]): Category | undefined {
  const t = text.toLowerCase().trim();
  const exact = cats.find((c) => c.name.toLowerCase() === t);
  if (exact) return exact;
  return cats.find((c) => {
    const n = c.name.toLowerCase();
    return n.length > 2 && (n.includes(t) || t.includes(n));
  });
}

function matchPerson(text: string, persons: HisaabPersonWithBalance[]): HisaabPersonWithBalance | undefined {
  const t = text.toLowerCase().trim();
  const exact = persons.find((p) => p.name.toLowerCase() === t);
  if (exact) return exact;
  return persons.find((p) => {
    const n = p.name.toLowerCase();
    return n.length > 2 && (n.includes(t) || t.includes(n));
  });
}

function accountDisplayLabel(a: FinancialAccount | undefined): string {
  if (!a) return "?";
  const last4 = (a.account_identifier ?? "").slice(-4);
  const base = a.account_label || a.bank_name || "Account";
  return last4 && /\d/.test(last4) ? `${base} (${last4})` : base;
}

// Enrich session from a general utterance — only resolves what it can
function enrichFromTranscript(
  transcript: string,
  session: VoiceSession,
  modes: PaymentMode[],
  accounts: FinancialAccount[],
  cats: Category[],
  persons: HisaabPersonWithBalance[],
): Partial<VoiceSession> {
  const t = transcript.toLowerCase();
  const wds = words3(t);
  const patch: Partial<VoiceSession> = {};

  // Transfer intent — flip session type and try to resolve from/to inline
  if (/\btransfer\b/i.test(transcript)) {
    patch.sessionType = "transfer";
    const fromMatch = transcript.match(/\bfrom\s+(\w+)/i);
    const toMatch = transcript.match(/\bto\s+(\w+)/i);
    if (fromMatch && !session.transferFromAccountId) {
      const m = findAllMatchingAccounts(fromMatch[1], accounts);
      if (m.length === 1) patch.transferFromAccountId = m[0].id;
    }
    if (toMatch && !session.transferToAccountId) {
      const m = findAllMatchingAccounts(toMatch[1], accounts);
      if (m.length === 1) patch.transferToAccountId = m[0].id;
    }
    return patch; // don't process expense fields
  }

  if (!session.paymentModeId) {
    const pm = modes.find((m) => { const n = m.name.toLowerCase(); return n.length > 1 && t.includes(n); });
    if (pm) patch.paymentModeId = pm.id;
  }

  // Account — only resolve if unambiguous
  if (!session.accountId) {
    const matches = findAllMatchingAccounts(transcript, accounts);
    if (matches.length === 1) patch.accountId = matches[0].id;
  }

  if (!session.categoryId) {
    const cat = cats.find((c) => c.name.length > 2 && t.includes(c.name.toLowerCase()));
    if (cat) patch.categoryId = cat.id;
  }

  // Split person detection
  if (!session.splitPersonId && /\bsplit\b/i.test(transcript)) {
    const afterSplit = transcript.match(/\bsplit\s+(?:with\s+)?(\w+)/i);
    if (afterSplit) {
      const p = matchPerson(afterSplit[1], persons);
      if (p) patch.splitPersonId = p.id;
    }
    if (!patch.splitPersonId) {
      for (const w of wds) {
        const p = matchPerson(w, persons);
        if (p) { patch.splitPersonId = p.id; break; }
      }
    }
  }

  return patch;
}

// ── Component ────────────────────────────────────────────────────────────────

export function VoiceEntrySheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const makeBlank = (): VoiceSession => ({ sessionType: "expense", confirming: false });
  const [session, setSession] = useState<VoiceSession>(makeBlank());
  const sessionRef = useRef<VoiceSession>(makeBlank());
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [transferDone, setTransferDone] = useState(false);

  // State tracking refs
  const pendingFieldRef = useRef<PendingField | null>(null);
  const skippedRef = useRef<Set<string>>(new Set());
  const ambiguousAccountRef = useRef<FinancialAccount[]>([]);
  const ambiguousFromRef = useRef<FinancialAccount[]>([]);
  const ambiguousToRef = useRef<FinancialAccount[]>([]);
  const currentQuestionRef = useRef("");

  // Reference data
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const dataRef = useRef({
    accounts: [] as FinancialAccount[],
    paymentModes: [] as PaymentMode[],
    categories: [] as Category[],
    persons: [] as HisaabPersonWithBalance[],
  });

  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({ voiceIdentifier: null, speakBack: true });

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (voiceState !== "idle") {
      pulseLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]));
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(0);
    }
  }, [voiceState, pulseAnim]);

  // Load reference data once
  useEffect(() => {
    setVoiceSettings(getVoiceSettings());
    Promise.all([
      getActiveAccounts(DEFAULT_USER_ID),
      getPaymentModes(DEFAULT_USER_ID),
      getCategories(DEFAULT_USER_ID),
      getPersonsWithBalances(DEFAULT_USER_ID),
    ]).then(([accts, pms, cats, ppl]) => {
      setAccounts(accts); setPaymentModes(pms); setCategories(cats); setPersons(ppl);
      dataRef.current = { accounts: accts, paymentModes: pms, categories: cats, persons: ppl };
    }).catch(() => {});
  }, []);

  const navigateRef = useRef((_s: VoiceSession) => {});
  navigateRef.current = (s: VoiceSession) => {
    onClose();
    const p: Record<string, string> = {};
    if (s.amount != null) p.prefillAmount = String(s.amount);
    if (s.merchant) p.prefillMerchant = s.merchant;
    if (s.description) p.prefillDescription = s.description;
    if (s.paymentModeId) p.prefillPaymentModeId = s.paymentModeId;
    if (s.accountId) p.prefillAccountId = s.accountId;
    if (s.categoryId) p.prefillCategoryId = s.categoryId;
    if (s.dateIso) p.prefillDate = s.dateIso;
    if (s.splitPersonId) p.prefillSplitPersonId = s.splitPersonId;
    setTimeout(() => router.push({ pathname: "/expense/add", params: p }), 300);
  };

  const doStartListening = () => {
    setVoiceState("listening");
    ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  };

  const doAsk = (question: string, field: PendingField) => {
    pendingFieldRef.current = field;
    currentQuestionRef.current = question;
    setCurrentQuestion(question);
    const settings = getVoiceSettings();
    if (settings.speakBack) {
      setVoiceState("speaking");
      Speech.speak(question, {
        voice: settings.voiceIdentifier ?? undefined,
        language: "en-IN",
        onDone: () => { setCurrentQuestion(""); doStartListening(); },
        onError: () => { setCurrentQuestion(""); doStartListening(); },
      });
    } else {
      doStartListening();
    }
  };

  const doCreateTransfer = async (s: VoiceSession) => {
    if (s.amount == null || !s.transferFromAccountId || !s.transferToAccountId) return;
    setVoiceState("idle");
    setCurrentQuestion("");
    currentQuestionRef.current = "";
    try {
      const today = new Date().toISOString().split("T")[0];
      await createTransfer({
        userId: DEFAULT_USER_ID,
        fromAccountId: s.transferFromAccountId,
        toAccountId: s.transferToAccountId,
        amount: s.amount,
        date: s.dateIso ?? today,
        source: "manual",
      });
      bumpDataVersion();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTransferDone(true);
      setTimeout(() => { onClose(); }, 1600);
    } catch {
      setCurrentQuestion("Couldn't save the transfer — please try again.");
      setTimeout(() => setCurrentQuestion(""), 2500);
    }
  };

  // Determine what to ask next given the current session state
  const determineNext = (s: VoiceSession) => {
    const { accounts: accts, categories: cats } = dataRef.current;
    const skipped = skippedRef.current;
    const catHint = cats.slice(0, 3).map((c) => c.name).join(", ");

    if (s.sessionType === "transfer") {
      if (s.amount == null) {
        doAsk("How much are you transferring?", "transferAmount");
      } else if (!s.transferFromAccountId) {
        const cands = ambiguousFromRef.current;
        if (cands.length > 1) {
          const opts = cands.map((a) => accountDisplayLabel(a)).join(", or ");
          doAsk(`You have ${cands.length} matching accounts: ${opts}. Say the last 4 digits to pick one.`, "transferFrom");
        } else {
          doAsk("Which account to transfer FROM? Say the bank name or last 4 digits.", "transferFrom");
        }
      } else if (!s.transferToAccountId) {
        const cands = ambiguousToRef.current;
        if (cands.length > 1) {
          const opts = cands.map((a) => accountDisplayLabel(a)).join(", or ");
          doAsk(`Multiple destination accounts found: ${opts}. Say the last 4 digits.`, "transferTo");
        } else {
          doAsk("Which account to transfer TO? Say the bank name or last 4 digits.", "transferTo");
        }
      } else {
        // All collected — ask for confirmation
        const fromAcc = accts.find((a) => a.id === s.transferFromAccountId);
        const toAcc = accts.find((a) => a.id === s.transferToAccountId);
        const amt = s.amount.toLocaleString("en-IN");
        const updated = { ...s, confirming: true };
        sessionRef.current = updated;
        setSession(updated);
        doAsk(
          `Transfer ₹${amt} from ${accountDisplayLabel(fromAcc)} to ${accountDisplayLabel(toAcc)}. Say yes to confirm or no to cancel.`,
          "transferConfirm"
        );
      }
    } else {
      if (s.amount == null) {
        doAsk("How much did you spend?", "amount");
      } else if (!s.merchant) {
        doAsk("Where did you spend it?", "merchant");
      } else if (!s.categoryId && !skipped.has("category")) {
        doAsk(
          catHint ? `What category? For example: ${catHint}. Say skip to continue.` : "What category? Say skip to continue.",
          "category"
        );
      } else if (!s.paymentModeId && !skipped.has("paymentMode")) {
        doAsk("How did you pay? UPI, cash, or card. Say skip to continue.", "paymentMode");
      } else if (!s.accountId && !skipped.has("account")) {
        const cands = ambiguousAccountRef.current;
        if (cands.length > 1) {
          const opts = cands.map((a) => accountDisplayLabel(a)).join(", or ");
          doAsk(`Multiple accounts found: ${opts}. Say the last 4 digits. Say skip to finish.`, "account");
        } else {
          doAsk("Which account? Say the bank name or last 4 digits. Say skip to finish.", "account");
        }
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigateRef.current(s);
      }
    }
  };

  const resetRefs = () => {
    pendingFieldRef.current = null;
    skippedRef.current = new Set();
    ambiguousAccountRef.current = [];
    ambiguousFromRef.current = [];
    ambiguousToRef.current = [];
    currentQuestionRef.current = "";
  };

  // Open/close handling
  useEffect(() => {
    if (visible) {
      setVoiceSettings(getVoiceSettings());
      const blank = makeBlank();
      sessionRef.current = blank;
      setSession(blank);
      setCurrentQuestion("");
      setLastHeard("");
      setTransferDone(false);
      resetRefs();
      setVoiceState("idle");
      const timer = setTimeout(async () => {
        const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!granted) { onClose(); return; }
        doStartListening();
      }, 400);
      return () => clearTimeout(timer);
    } else {
      Speech.stop();
      ExpoSpeechRecognitionModule.abort();
      setVoiceState("idle");
      setCurrentQuestion("");
      currentQuestionRef.current = "";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useSpeechRecognitionEvent("result", (event) => {
    if (!visible || !event.isFinal) return;
    const transcript = event.results[0]?.transcript ?? "";

    // Always show what was heard
    if (transcript) setLastHeard(transcript);
    if (!transcript) { setVoiceState("idle"); return; }

    const { accounts: accts, paymentModes: pms, categories: cats, persons: ppl } = dataRef.current;
    const prev = sessionRef.current;
    const pending = pendingFieldRef.current;

    // ── "Open form" command ───────────────────────────────────────────────────
    if (!prev.confirming && /\b(done|finish|that'?s? all|go ahead|open form)\b/i.test(transcript)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigateRef.current(prev);
      return;
    }

    // ── Transfer confirmation state ───────────────────────────────────────────
    if (prev.confirming) {
      if (/\b(yes|confirm|yep|sure|ok|save|proceed|yeah)\b/i.test(transcript)) {
        doCreateTransfer(prev);
      } else if (/\b(no|cancel|stop|abort|back|nope)\b/i.test(transcript)) {
        // Go back — reset accounts, keep amount, restart from "from" question
        const reset = { ...prev, confirming: false, transferFromAccountId: undefined, transferToAccountId: undefined };
        sessionRef.current = reset;
        setSession(reset);
        ambiguousFromRef.current = [];
        ambiguousToRef.current = [];
        pendingFieldRef.current = null;
        determineNext(reset);
      } else {
        // Unrecognised — re-ask confirm
        doAsk(currentQuestionRef.current, "transferConfirm");
      }
      return;
    }

    // ── "Skip" — skip current pending field, don't enrich ────────────────────
    if (/\b(skip|next|pass|move on)\b/i.test(transcript) && pending) {
      skippedRef.current.add(pending);
      pendingFieldRef.current = null;
      setCurrentQuestion("");
      currentQuestionRef.current = "";
      determineNext(prev);
      return;
    }

    // ── Parse and enrich ──────────────────────────────────────────────────────
    const parsed = parseVoiceInput(transcript);
    const updated: VoiceSession = {
      ...prev,
      amount: prev.amount ?? parsed.amount,
      merchant: prev.merchant ?? parsed.merchant,
      description: prev.description ?? parsed.description,
      dateIso: prev.dateIso ?? parsed.dateIso,
    };

    const enriched = enrichFromTranscript(transcript, updated, pms, accts, cats, ppl);
    Object.assign(updated, enriched);

    // ── Account disambiguation (when we specifically asked about an account) ──
    if (pending === "account" && !updated.accountId) {
      if (ambiguousAccountRef.current.length > 1) {
        // Already in disambiguation — try digit match within candidates
        const hit = matchByDigits(transcript, ambiguousAccountRef.current);
        if (hit) { updated.accountId = hit.id; ambiguousAccountRef.current = []; }
        // else: still unresolved — will re-ask via determineNext
      } else {
        // First answer to account question — check for ambiguity
        const cands = findAllMatchingAccounts(transcript, accts);
        if (cands.length === 1) {
          updated.accountId = cands[0].id;
          ambiguousAccountRef.current = [];
        } else if (cands.length > 1) {
          ambiguousAccountRef.current = cands;
          // don't set accountId — re-ask with disambiguation prompt
        }
      }
    }

    if (pending === "transferFrom" && !updated.transferFromAccountId) {
      if (ambiguousFromRef.current.length > 1) {
        const hit = matchByDigits(transcript, ambiguousFromRef.current);
        if (hit) { updated.transferFromAccountId = hit.id; ambiguousFromRef.current = []; }
      } else {
        const cands = findAllMatchingAccounts(transcript, accts);
        if (cands.length === 1) { updated.transferFromAccountId = cands[0].id; ambiguousFromRef.current = []; }
        else if (cands.length > 1) ambiguousFromRef.current = cands;
      }
    }

    if (pending === "transferTo" && !updated.transferToAccountId) {
      if (ambiguousToRef.current.length > 1) {
        const hit = matchByDigits(transcript, ambiguousToRef.current);
        if (hit) { updated.transferToAccountId = hit.id; ambiguousToRef.current = []; }
      } else {
        const cands = findAllMatchingAccounts(transcript, accts);
        if (cands.length === 1) { updated.transferToAccountId = cands[0].id; ambiguousToRef.current = []; }
        else if (cands.length > 1) ambiguousToRef.current = cands;
      }
    }

    // ── Question-context specific fallbacks ───────────────────────────────────
    if (pending === "paymentMode" && !updated.paymentModeId) {
      const pm = matchPaymentMode(transcript, pms);
      if (pm) updated.paymentModeId = pm.id;
    }
    if (pending === "category" && !updated.categoryId) {
      const cat = matchCategory(transcript, cats);
      if (cat) updated.categoryId = cat.id;
    }
    if (pending === "split" && !updated.splitPersonId) {
      const p = matchPerson(transcript, ppl);
      if (p) updated.splitPersonId = p.id;
    }
    // When specifically asked "where did you spend?", treat the full utterance as merchant
    if (pending === "merchant" && !updated.merchant && transcript.trim()) {
      updated.merchant = transcript.trim();
    }

    sessionRef.current = updated;
    setSession({ ...updated });
    setCurrentQuestion("");
    currentQuestionRef.current = "";
    pendingFieldRef.current = null;

    determineNext(updated);
  });

  useSpeechRecognitionEvent("error", () => { if (!visible) return; setVoiceState("idle"); });
  useSpeechRecognitionEvent("end", () => {
    if (!visible) return;
    setVoiceState((prev) => (prev === "listening" ? "idle" : prev));
  });

  const handleCancel = () => {
    Speech.stop();
    ExpoSpeechRecognitionModule.abort();
    setVoiceState("idle");
    setCurrentQuestion("");
    currentQuestionRef.current = "";
    onClose();
  };

  const handleDoneSoFar = () => {
    Speech.stop();
    ExpoSpeechRecognitionModule.abort();
    setCurrentQuestion("");
    currentQuestionRef.current = "";
    if (session.sessionType === "transfer") {
      onClose();
    } else {
      navigateRef.current(sessionRef.current);
    }
  };

  const indicatorColor = voiceState === "listening" ? theme.danger
    : voiceState === "speaking" ? accentColor
    : colors.textSecondary;

  const indicatorIcon: React.ComponentProps<typeof Ionicons>["name"] =
    voiceState === "listening" ? "radio-button-on"
    : voiceState === "speaking" ? "volume-high-outline"
    : "mic-outline";

  // Labels for chips
  const pmLabel = paymentModes.find((m) => m.id === session.paymentModeId)?.name;
  const acctLbl = (() => { const a = accounts.find((x) => x.id === session.accountId); return a ? accountDisplayLabel(a) : undefined; })();
  const catLbl = categories.find((c) => c.id === session.categoryId)?.name;
  const personLbl = persons.find((p) => p.id === session.splitPersonId)?.name;
  const fromLbl = (() => { const a = accounts.find((x) => x.id === session.transferFromAccountId); return a ? accountDisplayLabel(a) : undefined; })();
  const toLbl = (() => { const a = accounts.find((x) => x.id === session.transferToAccountId); return a ? accountDisplayLabel(a) : undefined; })();

  const isTransfer = session.sessionType === "transfer";
  const hasAnyData = session.amount != null || session.merchant || session.categoryId ||
    session.paymentModeId || session.accountId || session.splitPersonId ||
    session.transferFromAccountId || session.transferToAccountId;

  // Transfer success screen
  if (transferDone) {
    return (
      <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={40}>
        <View className="flex-1 items-center justify-center px-6 py-12">
          <Ionicons name="checkmark-circle" size={56} color={accentColor} />
          <Text className="text-lg font-bold text-foreground mt-4">Transfer saved</Text>
          {session.amount != null && fromLbl && toLbl && (
            <Text className="text-sm text-muted-foreground mt-2 text-center">
              ₹{session.amount.toLocaleString("en-IN")} from {fromLbl} to {toLbl}
            </Text>
          )}
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={70}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
        <Text className="text-lg font-bold text-foreground">
          {isTransfer ? "Voice Transfer" : "Voice Expense"}
        </Text>
        <Pressable onPress={handleCancel} className="p-1">
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Mic indicator */}
      <View className="items-center py-4">
        <Animated.View
          style={{
            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
            transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          }}
        >
          <Pressable
            onPress={voiceState === "idle" ? doStartListening : undefined}
            style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: voiceState !== "idle" ? `${indicatorColor}18` : `${accentColor}14`,
              alignItems: "center", justifyContent: "center",
              borderWidth: 2,
              borderColor: voiceState !== "idle" ? indicatorColor : `${accentColor}40`,
            }}
          >
            <Ionicons name={indicatorIcon} size={32} color={indicatorColor} />
          </Pressable>
        </Animated.View>

        {/* Question (silent mode) or state label */}
        {currentQuestion && !voiceSettings.speakBack ? (
          <Text className="mt-3 text-base font-semibold text-foreground text-center px-8" numberOfLines={4}>
            {currentQuestion}
          </Text>
        ) : (
          <Text className="mt-3 text-sm font-medium text-muted-foreground">
            {voiceState === "listening" ? "Listening…"
              : voiceState === "speaking" ? "Speaking…"
              : "Tap mic to retry"}
          </Text>
        )}

        {/* Hint on first open */}
        {voiceState === "listening" && !hasAnyData && !currentQuestion && (
          <Text className="mt-1.5 text-xs text-faint-foreground text-center px-8">
            {isTransfer
              ? 'Try: "transfer 500 from HDFC to SBI"'
              : 'Try: "450 at Swiggy for lunch, UPI, HDFC"'}
          </Text>
        )}

        {/* What was heard — always visible when non-empty */}
        {lastHeard ? (
          <Text className="mt-2 text-xs italic text-faint-foreground text-center px-10" numberOfLines={2}>
            Heard: &ldquo;{lastHeard}&rdquo;
          </Text>
        ) : null}
      </View>

      {/* Collected field chips */}
      {hasAnyData && (
        <View className="flex-row flex-wrap gap-2 justify-center px-6 pb-2">
          {session.amount != null && (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">
                ₹{session.amount.toLocaleString("en-IN")}
              </Text>
            </View>
          )}
          {session.merchant ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">{session.merchant}</Text>
            </View>
          ) : null}
          {catLbl ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">{catLbl}</Text>
            </View>
          ) : null}
          {pmLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">{pmLabel}</Text>
            </View>
          ) : null}
          {acctLbl ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">{acctLbl}</Text>
            </View>
          ) : null}
          {personLbl ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">Split · {personLbl}</Text>
            </View>
          ) : null}
          {session.dateIso ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">
                {session.dateIso === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? "Yesterday" : session.dateIso}
              </Text>
            </View>
          ) : null}
          {fromLbl ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">From · {fromLbl}</Text>
            </View>
          ) : null}
          {toLbl ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-card">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 font-medium text-foreground">To · {toLbl}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Bottom action */}
      <View className="px-5 pt-3 pb-6">
        <Pressable
          onPress={handleDoneSoFar}
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: `${accentColor}18`, borderWidth: 1, borderColor: `${accentColor}35` }}
        >
          <Text className="text-sm font-semibold" style={{ color: accentColor }}>
            {isTransfer ? "Cancel" : hasAnyData ? "Fill form with what I said" : "Open expense form"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
