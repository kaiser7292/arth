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
import { parseVoiceInput } from "@/utils/voice-parser";

type VoiceState = "idle" | "listening" | "speaking";

interface VoiceSession {
  amount?: number;
  merchant?: string;
  description?: string;
  paymentMode?: string;
  dateIso?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function VoiceEntrySheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { accent, colors } = useColorScheme();
  const accentColor = accent[500];

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [session, setSession] = useState<VoiceSession>({});
  const sessionRef = useRef<VoiceSession>({});
  const [lastHeard, setLastHeard] = useState("");

  // Pulse animation for the listening/speaking indicator
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

  // Stable ref for navigate so event handlers don't capture stale closures
  const navigateRef = useRef((s: VoiceSession) => {
    onClose();
    const params: Record<string, string> = {};
    if (s.amount != null) params.prefillAmount = String(s.amount);
    if (s.merchant) params.prefillMerchant = s.merchant;
    if (s.description) params.prefillDescription = s.description;
    if (s.paymentMode) params.prefillPaymentMode = s.paymentMode;
    if (s.dateIso) params.prefillDate = s.dateIso;
    setTimeout(() => router.push({ pathname: "/expense/add", params }), 300);
  });
  navigateRef.current = (s: VoiceSession) => {
    onClose();
    const params: Record<string, string> = {};
    if (s.amount != null) params.prefillAmount = String(s.amount);
    if (s.merchant) params.prefillMerchant = s.merchant;
    if (s.description) params.prefillDescription = s.description;
    if (s.paymentMode) params.prefillPaymentMode = s.paymentMode;
    if (s.dateIso) params.prefillDate = s.dateIso;
    setTimeout(() => router.push({ pathname: "/expense/add", params }), 300);
  };

  const doStartListening = () => {
    setVoiceState("listening");
    ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  };

  const doAsk = (question: string) => {
    setVoiceState("speaking");
    Speech.speak(question, {
      language: "en-IN",
      onDone: doStartListening,
      onError: doStartListening,
    });
  };

  // Start/stop listening when sheet opens/closes
  useEffect(() => {
    if (visible) {
      sessionRef.current = {};
      setSession({});
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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useSpeechRecognitionEvent("result", (event) => {
    if (!visible || !event.isFinal) return;
    const transcript = event.results[0]?.transcript ?? "";
    if (transcript) setLastHeard(transcript);

    if (!transcript) { setVoiceState("idle"); return; }

    // "Skip" / "done" → navigate with whatever we have
    if (/\b(skip|done|finish|that'?s? all|go ahead)\b/i.test(transcript)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigateRef.current(sessionRef.current);
      return;
    }

    const parsed = parseVoiceInput(transcript);
    const updated: VoiceSession = {
      amount: sessionRef.current.amount ?? parsed.amount,
      merchant: sessionRef.current.merchant ?? parsed.merchant,
      description: sessionRef.current.description ?? parsed.description,
      paymentMode: sessionRef.current.paymentMode ?? parsed.paymentModeName,
      dateIso: sessionRef.current.dateIso ?? parsed.dateIso,
    };
    sessionRef.current = updated;
    setSession({ ...updated });

    const finish = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigateRef.current(updated);
    };

    if (updated.amount == null) {
      doAsk("How much did you spend?");
    } else if (!updated.merchant) {
      doAsk("Where did you spend it?");
    } else if (!updated.description) {
      doAsk("What was it for? Say skip to continue.");
    } else if (!updated.paymentMode) {
      doAsk("How did you pay? Say U P I, cash, or card. Or say skip to finish.");
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
    onClose();
  };

  const handleDoneSoFar = () => {
    Speech.stop();
    ExpoSpeechRecognitionModule.abort();
    navigateRef.current(sessionRef.current);
  };

  const indicatorColor = voiceState === "listening" ? "#EF4444"
    : voiceState === "speaking" ? accentColor
    : colors.textSecondary;

  const indicatorIcon = voiceState === "listening" ? "radio-button-on"
    : voiceState === "speaking" ? "volume-high-outline"
    : "mic-outline";

  const stateLabel = voiceState === "listening" ? "Listening…"
    : voiceState === "speaking" ? "Speaking…"
    : "Tap mic to retry";

  const hasAnyData = session.amount != null || session.merchant || session.description || session.paymentMode;

  return (
    <BottomSheet visible={visible} onClose={handleCancel} maxHeightPct={55}>
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
      <View className="items-center py-6">
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

        <Text className="mt-3 text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
          {stateLabel}
        </Text>

        {voiceState === "listening" && !hasAnyData && (
          <Text className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary text-center px-8">
            Try: "450 at Swiggy for lunch by UPI"
          </Text>
        )}

        {lastHeard && voiceState !== "listening" && (
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
          {session.description ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {session.description}
              </Text>
            </View>
          ) : null}
          {session.paymentMode ? (
            <View className="flex-row items-center px-3 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="checkmark-circle" size={13} color={accentColor} />
              <Text className="text-sm ml-1.5 text-text-primary dark:text-text-dark-primary font-medium">
                {session.paymentMode}
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

      {/* Done so far button */}
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
