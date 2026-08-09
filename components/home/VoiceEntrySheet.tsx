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
import { getVoiceSettings } from "@/services/voice-settings";
import type { VoiceSettings } from "@/services/voice-settings";

type VoiceState = "idle" | "listening" | "speaking";

interface VoiceSession {
  amount?: number;
  merchant?: string;
  description?: string;
  paymentModeId?: string;
  accountId?: string;
  categoryId?: string;
  dateIso?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Fuzzy matching helpers ──────────────────────────────────────────────────

function matchPaymentMode(text: string, modes: PaymentMode[]): PaymentMode | undefined {
  const t = text.toLowerCase().trim();
  // Exact name first
  const exact = modes.find((m) => m.name.toLowerCase() === t);
  if (exact) return exact;
  // Contains in either direction
  return modes.find((m) => {
    const n = m.name.toLowerCase();
    return n.includes(t) || t.includes(n);
  });
}

function matchAccount(text: string, accounts: FinancialAccount[]): FinancialAccount | undefined {
  const t = text.toLowerCase().trim();
  // Last-4 exact match
  const byDigits = accounts.find((a) => a.account_identifier === t || t.includes(a.account_identifier.slice(-4)));
  if (byDigits) return byDigits;
  // Bank name or label contains/contained-by transcript
  return accounts.find((a) => {
    const bank = (a.bank_name ?? "").toLowerCase();
    const label = (a.account_label ?? "").toLowerCase();
    return (bank.length > 1 && (bank.includes(t) || t.includes(bank))) ||
           (label.length > 1 && (label.includes(t) || t.includes(label)));
  });
}

function matchCategory(text: string, cats: Category[]): Category | undefined {
  const t = text.toLowerCase().trim();
  const exact = cats.find((c) => c.name.toLowerCase() === t);
  if (exact) return exact;
  return cats.find((c) => {
    const n = c.name.toLowerCase();
    return n.includes(t) || t.includes(n);
  });
}

// Try to detect payment mode, account, category directly from a transcript
// against the loaded DB data (not just keywords)
function enrichFromTranscript(
  transcript: string,
  session: VoiceSession,
  modes: PaymentMode[],
  accounts: FinancialAccount[],
  cats: Category[],
): Partial<VoiceSession> {
  const t = transcript.toLowerCase();
  const patch: Partial<VoiceSession> = {};

  if (!session.paymentModeId) {
    // Try each mode's name against the transcript
    const pm = modes.find((m) => {
      const n = m.name.toLowerCase();
      return n.length > 1 && t.includes(n);
    });
    if (pm) patch.paymentModeId = pm.id;
  }

  if (!session.accountId) {
    const acct = accounts.find((a) => {
      const bank = (a.bank_name ?? "").toLowerCase();
      const label = (a.account_label ?? "").toLowerCase();
      return (bank.length > 2 && t.includes(bank)) ||
             (label.length > 2 && t.includes(label));
    });
    if (acct) patch.accountId = acct.id;
  }

  if (!session.categoryId) {
    const cat = cats.find((c) => c.name.length > 2 && t.includes(c.name.toLowerCase()));
    if (cat) patch.categoryId = cat.id;
  }

  return patch;
}

export function VoiceEntrySheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { accent, colors } = useColorScheme();
  const accentColor = accent[500];

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [session, setSession] = useState<VoiceSession>({});
  const sessionRef = useRef<VoiceSession>({});
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [lastHeard, setLastHeard] = useState("");

  // Loaded reference data
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const dataRef = useRef({ accounts: [] as FinancialAccount[], paymentModes: [] as PaymentMode[], categories: [] as Category[] });

  // Voice settings
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
    ]).then(([accts, pms, cats]) => {
      setAccounts(accts);
      setPaymentModes(pms);
      setCategories(cats);
      dataRef.current = { accounts: accts, paymentModes: pms, categories: cats };
    }).catch(() => {/* DB not ready, proceed without */});
  }, []);

  // Stable ref for navigate
  const navigateRef = useRef((s: VoiceSession) => { });
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
    setTimeout(() => router.push({ pathname: "/expense/add", params }), 300);
  };

  const doStartListening = () => {
    setVoiceState("listening");
    ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  };

  const doAsk = (question: string) => {
    setCurrentQuestion(question);
    const settings = getVoiceSettings(); // read fresh in case user just changed it
    if (settings.speakBack) {
      setVoiceState("speaking");
      Speech.speak(question, {
        voice: settings.voiceIdentifier ?? undefined,
        language: "en-IN",
        onDone: () => { setCurrentQuestion(""); doStartListening(); },
        onError: () => { setCurrentQuestion(""); doStartListening(); },
      });
    } else {
      // Silent mode — show question as text, listen immediately
      doStartListening();
    }
  };

  // Start/stop when sheet opens/closes
  useEffect(() => {
    if (visible) {
      setVoiceSettings(getVoiceSettings()); // refresh settings on each open
      sessionRef.current = {};
      setSession({});
      setCurrentQuestion("");
      setLastHeard("");
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

    const { accounts: accts, paymentModes: pms, categories: cats } = dataRef.current;
    const parsed = parseVoiceInput(transcript);

    // Build updated session merging previous + new parsed values
    const prev = sessionRef.current;
    const updated: VoiceSession = {
      amount: prev.amount ?? parsed.amount,
      merchant: prev.merchant ?? parsed.merchant,
      description: prev.description ?? parsed.description,
      dateIso: prev.dateIso ?? parsed.dateIso,
      paymentModeId: prev.paymentModeId,
      accountId: prev.accountId,
      categoryId: prev.categoryId,
    };

    // Try to resolve PM, account, category from this transcript against DB data
    const enriched = enrichFromTranscript(transcript, updated, pms, accts, cats);
    Object.assign(updated, enriched);

    // If we're responding to a specific question, also try direct matching
    const q = currentQuestion.toLowerCase();
    if (!updated.paymentModeId && (q.includes("pay") || q.includes("upi") || q.includes("cash"))) {
      const pm = matchPaymentMode(transcript, pms);
      if (pm) updated.paymentModeId = pm.id;
    }
    if (!updated.accountId && (q.includes("account") || q.includes("bank"))) {
      const acct = matchAccount(transcript, accts);
      if (acct) updated.accountId = acct.id;
    }
    if (!updated.categoryId && (q.includes("categor") || q.includes("type"))) {
      const cat = matchCategory(transcript, cats);
      if (cat) updated.categoryId = cat.id;
    }

    sessionRef.current = updated;
    setSession({ ...updated });
    setCurrentQuestion("");

    const finish = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigateRef.current(updated);
    };

    // Category names for the question hint (pick up to 3)
    const catHint = cats.slice(0, 3).map((c) => c.name).join(", ");

    if (updated.amount == null) {
      doAsk("How much did you spend?");
    } else if (!updated.merchant) {
      doAsk("Where did you spend it?");
    } else if (!updated.categoryId) {
      doAsk(catHint ? `What category? For example, ${catHint}. Say skip to continue.` : "What category? Say skip to continue.");
    } else if (!updated.paymentModeId) {
      doAsk("How did you pay? UPI, cash, or card. Say skip to continue.");
    } else if (!updated.accountId) {
      doAsk("Which account? Say your bank name or last 4 digits. Say skip to finish.");
    } else {
      finish();
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
    onClose();
  };

  const handleDoneSoFar = () => {
    Speech.stop();
    ExpoSpeechRecognitionModule.abort();
    setCurrentQuestion("");
    navigateRef.current(sessionRef.current);
  };

  const indicatorColor = voiceState === "listening" ? "#EF4444"
    : voiceState === "speaking" ? accentColor
    : colors.textSecondary;

  const indicatorIcon = voiceState === "listening" ? "radio-button-on"
    : voiceState === "speaking" ? "volume-high-outline"
    : "mic-outline";

  const stateLabel = currentQuestion && !voiceSettings.speakBack ? currentQuestion
    : voiceState === "listening" ? "Listening…"
    : voiceState === "speaking" ? "Speaking…"
    : "Tap mic to retry";

  const hasAnyData = session.amount != null || session.merchant || session.categoryId ||
    session.paymentModeId || session.accountId;

  // Friendly label for a resolved ID
  const pmLabel = paymentModes.find((m) => m.id === session.paymentModeId)?.name;
  const acctLabel = (() => {
    const a = accounts.find((x) => x.id === session.accountId);
    return a ? (a.account_label || a.bank_name) : undefined;
  })();
  const catLabel = categories.find((c) => c.id === session.categoryId)?.name;

  return (
    <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={60}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
        <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
          Voice Expense
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

        {/* Question or state label */}
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
          <Text className="mt-1.5 text-xs text-text-tertiary dark:text-text-dark-tertiary text-center px-8">
            Try: "450 at Swiggy for lunch, UPI, HDFC"
          </Text>
        )}

        {lastHeard && voiceState !== "listening" && !currentQuestion && (
          <Text
            className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary text-center px-8"
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
                {"₹"}{session.amount.toLocaleString("en-IN")}
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
          {session.dateIso ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {session.dateIso === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? "Yesterday" : session.dateIso}
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
            {hasAnyData ? "Fill form with what I said" : "Open expense form"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
