import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
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

type VoiceState = "idle" | "listening" | "speaking";

type SessionType = "expense" | "transfer";

interface VoiceSession {
  sessionType: SessionType;
  // Expense
  amount?: number;
  merchant?: string;
  description?: string;
  paymentModeId?: string;
  accountId?: string;
  categoryId?: string;
  dateIso?: string;
  splitPersonId?: string;
  // Transfer
  transferFromAccountId?: string;
  transferToAccountId?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Matching helpers ────────────────────────────────────────────────────────

function words3(t: string): string[] {
  return t.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
}

function wordMatchesName(word: string, name: string): boolean {
  const n = name.toLowerCase();
  return n.length > 2 && (n.includes(word) || word.includes(n));
}

function matchPaymentMode(text: string, modes: PaymentMode[]): PaymentMode | undefined {
  const t = text.toLowerCase().trim();
  const exact = modes.find((m) => m.name.toLowerCase() === t);
  if (exact) return exact;
  return modes.find((m) => {
    const n = m.name.toLowerCase();
    return n.length > 1 && (n.includes(t) || t.includes(n));
  });
}

function matchAccount(text: string, accounts: FinancialAccount[]): FinancialAccount | undefined {
  const t = text.toLowerCase().trim();
  // Last-4 digits match
  const byDigits = accounts.find(
    (a) => a.account_identifier && (
      a.account_identifier === t ||
      (a.account_identifier.length >= 4 && t.includes(a.account_identifier.slice(-4)))
    )
  );
  if (byDigits) return byDigits;
  // Bidirectional word match on bank_name / account_label
  return accounts.find((a) => {
    const bank = (a.bank_name ?? "").toLowerCase();
    const label = (a.account_label ?? "").toLowerCase();
    return (bank.length > 2 && (bank.includes(t) || t.includes(bank))) ||
           (label.length > 2 && (label.includes(t) || t.includes(label)));
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

function matchPerson(
  text: string,
  persons: HisaabPersonWithBalance[],
): HisaabPersonWithBalance | undefined {
  const t = text.toLowerCase().trim();
  const exact = persons.find((p) => p.name.toLowerCase() === t);
  if (exact) return exact;
  return persons.find((p) => {
    const n = p.name.toLowerCase();
    return n.length > 2 && (n.includes(t) || t.includes(n));
  });
}

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

  // Detect transfer intent
  if (/\btransfer\b/i.test(transcript)) {
    patch.sessionType = "transfer";
    const fromMatch = transcript.match(/\bfrom\s+(\w+)/i);
    const toMatch = transcript.match(/\bto\s+(\w+)/i);
    if (fromMatch && !session.transferFromAccountId) {
      const a = matchAccount(fromMatch[1], accounts);
      if (a) patch.transferFromAccountId = a.id;
    }
    if (toMatch && !session.transferToAccountId) {
      const a = matchAccount(toMatch[1], accounts);
      if (a) patch.transferToAccountId = a.id;
    }
    return patch; // don't process expense fields for transfer
  }

  // Payment mode
  if (!session.paymentModeId) {
    const pm = modes.find((m) => {
      const n = m.name.toLowerCase();
      return n.length > 1 && t.includes(n);
    });
    if (pm) patch.paymentModeId = pm.id;
  }

  // Account — word-by-word bidirectional match
  if (!session.accountId) {
    const acct = accounts.find((a) => {
      const bank = (a.bank_name ?? "").toLowerCase();
      const label = (a.account_label ?? "").toLowerCase();
      return wds.some((w) => wordMatchesName(w, bank) || wordMatchesName(w, label));
    });
    if (acct) patch.accountId = acct.id;
  }

  // Category
  if (!session.categoryId) {
    const cat = cats.find((c) => c.name.length > 2 && t.includes(c.name.toLowerCase()));
    if (cat) patch.categoryId = cat.id;
  }

  // Split with person
  if (!session.splitPersonId && /\bsplit\b/i.test(transcript)) {
    const afterSplit = transcript.match(/\bsplit\s+(?:with\s+)?(\w+)/i);
    if (afterSplit) {
      const p = matchPerson(afterSplit[1], persons);
      if (p) patch.splitPersonId = p.id;
    }
    if (!patch.splitPersonId) {
      // fallback: any word matches a person name
      for (const w of wds) {
        const p = matchPerson(w, persons);
        if (p) { patch.splitPersonId = p.id; break; }
      }
    }
  }

  return patch;
}

export function VoiceEntrySheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { accent, colors } = useColorScheme();
  const accentColor = accent[500];

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [session, setSession] = useState<VoiceSession>({ sessionType: "expense" });
  const sessionRef = useRef<VoiceSession>({ sessionType: "expense" });
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [transferDone, setTransferDone] = useState(false);

  // Loaded reference data
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
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(0);
    }
  }, [voiceState, pulseAnim]);

  // Load reference data + voice settings on first render
  useEffect(() => {
    setVoiceSettings(getVoiceSettings());
    Promise.all([
      getActiveAccounts(DEFAULT_USER_ID),
      getPaymentModes(DEFAULT_USER_ID),
      getCategories(DEFAULT_USER_ID),
      getPersonsWithBalances(DEFAULT_USER_ID),
    ]).then(([accts, pms, cats, ppl]) => {
      setAccounts(accts);
      setPaymentModes(pms);
      setCategories(cats);
      setPersons(ppl);
      dataRef.current = { accounts: accts, paymentModes: pms, categories: cats, persons: ppl };
    }).catch(() => {});
  }, []);

  // Stable ref for navigate
  const navigateRef = useRef((_s: VoiceSession) => {});
  navigateRef.current = (s: VoiceSession) => {
    onClose();
    const params: Record<string, string> = {};
    if (s.amount != null) params.prefillAmount = String(s.amount);
    if (s.merchant) params.prefillMerchant = s.merchant;
    if (s.description) params.prefillDescription = s.description;
    if (s.paymentModeId) params.prefillPaymentModeId = s.paymentModeId;
    if (s.accountId) params.prefillAccountId = s.accountId;
    if (s.categoryId) params.prefillCategoryId = s.categoryId;
    if (s.dateIso) params.prefillDate = s.dateIso;
    if (s.splitPersonId) params.prefillSplitPersonId = s.splitPersonId;
    setTimeout(() => router.push({ pathname: "/expense/add", params }), 300);
  };

  const doStartListening = () => {
    setVoiceState("listening");
    ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  };

  const currentQuestionRef = useRef("");
  const doAsk = (question: string) => {
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
      setCurrentQuestion("Couldn't save — please add the transfer manually.");
      setTimeout(() => { setCurrentQuestion(""); onClose(); }, 2500);
    }
  };

  // Start/stop when sheet opens/closes
  useEffect(() => {
    if (visible) {
      setVoiceSettings(getVoiceSettings());
      const blank: VoiceSession = { sessionType: "expense" };
      sessionRef.current = blank;
      setSession(blank);
      setCurrentQuestion("");
      currentQuestionRef.current = "";
      setLastHeard("");
      setTransferDone(false);
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
    if (transcript) setLastHeard(transcript);
    if (!transcript) { setVoiceState("idle"); return; }

    if (/\b(skip|done|finish|that'?s? all|go ahead|open form)\b/i.test(transcript)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigateRef.current(sessionRef.current);
      return;
    }

    const { accounts: accts, paymentModes: pms, categories: cats, persons: ppl } = dataRef.current;
    const parsed = parseVoiceInput(transcript);
    const prev = sessionRef.current;
    const q = currentQuestionRef.current.toLowerCase();

    const updated: VoiceSession = {
      sessionType: prev.sessionType,
      amount: prev.amount ?? parsed.amount,
      merchant: prev.merchant ?? parsed.merchant,
      description: prev.description ?? parsed.description,
      dateIso: prev.dateIso ?? parsed.dateIso,
      paymentModeId: prev.paymentModeId,
      accountId: prev.accountId,
      categoryId: prev.categoryId,
      splitPersonId: prev.splitPersonId,
      transferFromAccountId: prev.transferFromAccountId,
      transferToAccountId: prev.transferToAccountId,
    };

    // Enrich from transcript (handles transfer detection, account, category, PM, split)
    const enriched = enrichFromTranscript(transcript, updated, pms, accts, cats, ppl);
    Object.assign(updated, enriched);

    // Question-specific fallback matching
    if (!updated.paymentModeId && (q.includes("pay") || q.includes("upi") || q.includes("cash"))) {
      const pm = matchPaymentMode(transcript, pms);
      if (pm) updated.paymentModeId = pm.id;
    }
    if (!updated.accountId && (q.includes("account") || q.includes("bank") || q.includes("from"))) {
      const acct = matchAccount(transcript, accts);
      if (acct) updated.accountId = acct.id;
    }
    if (!updated.transferFromAccountId && q.includes("from")) {
      const acct = matchAccount(transcript, accts);
      if (acct) updated.transferFromAccountId = acct.id;
    }
    if (!updated.transferToAccountId && q.includes("to")) {
      const acct = matchAccount(transcript, accts);
      if (acct) updated.transferToAccountId = acct.id;
    }
    if (!updated.categoryId && (q.includes("categor") || q.includes("type"))) {
      const cat = matchCategory(transcript, cats);
      if (cat) updated.categoryId = cat.id;
    }
    if (!updated.splitPersonId && (q.includes("split") || q.includes("who"))) {
      const p = matchPerson(transcript, ppl);
      if (p) updated.splitPersonId = p.id;
    }

    sessionRef.current = updated;
    setSession({ ...updated });
    setCurrentQuestion("");
    currentQuestionRef.current = "";

    const catHint = cats.slice(0, 3).map((c) => c.name).join(", ");

    if (updated.sessionType === "transfer") {
      if (updated.amount == null) {
        doAsk("How much are you transferring?");
      } else if (!updated.transferFromAccountId) {
        doAsk("Which account are you transferring FROM? Say your bank name.");
      } else if (!updated.transferToAccountId) {
        doAsk("Which account TO? Say your bank name.");
      } else {
        doCreateTransfer(updated);
      }
    } else {
      if (updated.amount == null) {
        doAsk("How much did you spend?");
      } else if (!updated.merchant) {
        doAsk("Where did you spend it?");
      } else if (!updated.categoryId) {
        doAsk(catHint ? `What category? For example, ${catHint}. Say skip.` : "What category? Say skip.");
      } else if (!updated.paymentModeId) {
        doAsk("How did you pay? UPI, cash, or card. Say skip.");
      } else if (!updated.accountId) {
        doAsk("Which account? Say your bank name. Say skip to finish.");
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigateRef.current(updated);
      }
    }
  });

  useSpeechRecognitionEvent("error", () => {
    if (!visible) return;
    setVoiceState("idle");
  });

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

  const indicatorColor = voiceState === "listening" ? "#EF4444"
    : voiceState === "speaking" ? accentColor
    : colors.textSecondary;

  const indicatorIcon: React.ComponentProps<typeof Ionicons>["name"] =
    voiceState === "listening" ? "radio-button-on"
    : voiceState === "speaking" ? "volume-high-outline"
    : "mic-outline";

  // Friendly labels
  const pmLabel = paymentModes.find((m) => m.id === session.paymentModeId)?.name;
  const acctLabel = (() => {
    const a = accounts.find((x) => x.id === session.accountId);
    return a ? (a.account_label || a.bank_name) : undefined;
  })();
  const catLabel = categories.find((c) => c.id === session.categoryId)?.name;
  const personLabel = persons.find((p) => p.id === session.splitPersonId)?.name;
  const fromAcctLabel = (() => {
    const a = accounts.find((x) => x.id === session.transferFromAccountId);
    return a ? (a.account_label || a.bank_name) : undefined;
  })();
  const toAcctLabel = (() => {
    const a = accounts.find((x) => x.id === session.transferToAccountId);
    return a ? (a.account_label || a.bank_name) : undefined;
  })();

  const isTransfer = session.sessionType === "transfer";
  const hasAnyData = session.amount != null || session.merchant || session.categoryId ||
    session.paymentModeId || session.accountId || session.splitPersonId ||
    session.transferFromAccountId || session.transferToAccountId;

  if (transferDone) {
    return (
      <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={40}>
        <View className="flex-1 items-center justify-center px-6 py-12">
          <Ionicons name="checkmark-circle" size={56} color={accentColor} />
          <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary mt-4">
            Transfer saved
          </Text>
          {session.amount != null && fromAcctLabel && toAcctLabel && (
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2 text-center">
              ₹{session.amount.toLocaleString("en-IN")} from {fromAcctLabel} to {toAcctLabel}
            </Text>
          )}
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={65}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
        <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
          {isTransfer ? "Voice Transfer" : "Voice Expense"}
        </Text>
        <Pressable onPress={handleCancel} className="p-1">
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Indicator */}
      <View className="items-center py-5">
        <Animated.View
          style={{
            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
            transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          }}
        >
          <Pressable
            onPress={voiceState === "idle" ? doStartListening : undefined}
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: voiceState !== "idle" ? `${indicatorColor}18` : `${accentColor}14`,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: voiceState !== "idle" ? indicatorColor : `${accentColor}40`,
            }}
          >
            <Ionicons name={indicatorIcon} size={32} color={indicatorColor} />
          </Pressable>
        </Animated.View>

        {currentQuestion && !voiceSettings.speakBack ? (
          <Text
            className="mt-3 text-base font-semibold text-text-primary dark:text-text-dark-primary text-center px-8"
            numberOfLines={3}
          >
            {currentQuestion}
          </Text>
        ) : (
          <Text className="mt-3 text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
            {voiceState === "listening" ? "Listening…"
              : voiceState === "speaking" ? "Speaking…"
              : "Tap mic to retry"}
          </Text>
        )}

        {voiceState === "listening" && !hasAnyData && !currentQuestion && (
          <Text className="mt-1.5 text-xs text-text-tertiary text-center px-8">
            {isTransfer
              ? 'Try: "transfer 500 from HDFC to SBI"'
              : 'Try: "450 at Swiggy for lunch, UPI, HDFC"'}
          </Text>
        )}

        {lastHeard && voiceState !== "listening" && !currentQuestion && (
          <Text
            className="mt-1 text-xs text-text-tertiary text-center px-8"
            numberOfLines={2}
          >
            "{lastHeard}"
          </Text>
        )}
      </View>

      {/* Collected field chips */}
      {hasAnyData && (
        <View className="flex-row flex-wrap gap-2 justify-center px-6 pb-2">
          {session.amount != null && (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                ₹{session.amount.toLocaleString("en-IN")}
              </Text>
            </View>
          )}
          {session.merchant ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {session.merchant}
              </Text>
            </View>
          ) : null}
          {catLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {catLabel}
              </Text>
            </View>
          ) : null}
          {pmLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {pmLabel}
              </Text>
            </View>
          ) : null}
          {acctLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {acctLabel}
              </Text>
            </View>
          ) : null}
          {personLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                Split · {personLabel}
              </Text>
            </View>
          ) : null}
          {session.dateIso ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {session.dateIso === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? "Yesterday" : session.dateIso}
              </Text>
            </View>
          ) : null}
          {fromAcctLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                From · {fromAcctLabel}
              </Text>
            </View>
          ) : null}
          {toAcctLabel ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                To · {toAcctLabel}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Done so far */}
      <View className="px-5 pt-3 pb-6">
        <Pressable
          onPress={handleDoneSoFar}
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: `${accentColor}18`, borderWidth: 1, borderColor: `${accentColor}35` }}
        >
          <Text className="text-sm font-semibold" style={{ color: accentColor }}>
            {isTransfer
              ? "Cancel transfer"
              : hasAnyData ? "Fill form with what I said" : "Open expense form"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
