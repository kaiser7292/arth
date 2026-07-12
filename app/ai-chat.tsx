import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  chatWithAI,
  initAIContext,
  isAIDataAccountsEnabled,
  isAIDataBudgetEnabled,
  isAIDataExpensesEnabled,
  isAIDataHisaabEnabled,
  isAIDataVaultEnabled,
  isArthAIEnabled,
  isModelDownloaded,
  releaseAIContext,
  type ChatMessage,
} from "@/services/ai-assistant";
import { buildAIDataContext } from "@/services/ai-data-context";
import { ac } from "@/utils/accent";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const SUGGESTIONS = [
  "How much did I spend this month?",
  "What's my biggest expense category?",
  "Am I over budget?",
  "Summarise last month's spending",
];

type LoadState = "checking" | "loading" | "ready" | "no_model" | "disabled";

export default function AIChatScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();

  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const isMounted = useRef(true);

  // Initialise model on mount
  useEffect(() => {
    isMounted.current = true;
    (async () => {
      if (!isArthAIEnabled()) {
        setLoadState("disabled");
        return;
      }
      const downloaded = await isModelDownloaded();
      if (!downloaded) {
        setLoadState("no_model");
        return;
      }
      setLoadState("loading");
      try {
        await initAIContext();
        if (isMounted.current) setLoadState("ready");
      } catch {
        if (isMounted.current) setLoadState("no_model");
      }
    })();

    return () => {
      isMounted.current = false;
    };
  }, []);

  // Release context when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") releaseAIContext();
    });
    return () => sub.remove();
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating || loadState !== "ready") return;

      const userMsg: DisplayMessage = {
        id: Date.now().toString(),
        role: "user",
        content: trimmed,
      };
      const aiMsgId = (Date.now() + 1).toString();
      const aiMsg: DisplayMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];
      setInputText("");
      setIsGenerating(true);
      scrollToBottom();

      let fullText = "";
      try {
        const dataContext = await buildAIDataContext({
          expenses: isAIDataExpensesEnabled(),
          accounts: isAIDataAccountsEnabled(),
          budget: isAIDataBudgetEnabled(),
          hisaab: isAIDataHisaabEnabled(),
          vault: isAIDataVaultEnabled(),
        });
        const trimmedHistory = historyRef.current.slice(-6);
        fullText = await chatWithAI(trimmedHistory, (token) => {
          if (!isMounted.current) return;
          fullText += token;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullText } : m)),
          );
          scrollToBottom();
        }, dataContext || undefined);
        historyRef.current = [
          ...historyRef.current,
          { role: "assistant", content: fullText },
        ];
      } catch (e) {
        const errText = "Something went wrong. Try again.";
        if (isMounted.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: errText, streaming: false } : m)),
          );
        }
      } finally {
        if (isMounted.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m)),
          );
          setIsGenerating(false);
        }
      }
    },
    [isGenerating, loadState, scrollToBottom],
  );

  const accentColor = accent[500];

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      {/* Header */}
      <View
        className="flex-row items-center px-4 pt-14 pb-3 border-b border-border-light dark:border-border-dark"
        style={{ backgroundColor: colors.background }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} className="mr-3">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}
        >
          <Ionicons name="sparkles" size={16} color={accentColor} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
            Arth AI
          </Text>
          <Text className="text-xs" style={{ color: loadState === "ready" ? "#3fb950" : colors.textSecondary }}>
            {loadState === "ready"
              ? "On-device · private"
              : loadState === "loading"
              ? "Loading model…"
              : ""}
          </Text>
        </View>
      </View>

      {/* Loading / error states */}
      {loadState === "checking" || loadState === "loading" ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={accentColor} />
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
            {loadState === "loading" ? "Loading AI model… (first time takes a few seconds)" : "Checking model…"}
          </Text>
        </View>
      ) : loadState === "disabled" ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Ionicons name="sparkles-outline" size={40} color={colors.textSecondary} />
          <Text className="text-base font-semibold text-center text-text-primary dark:text-text-dark-primary">
            Arth AI is disabled
          </Text>
          <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary">
            Enable it in Settings → Arth AI to get started.
          </Text>
          <Pressable
            onPress={() => router.push("/settings/ai-assistant" as never)}
            className="px-5 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
          >
            <Text className="text-sm font-semibold text-white">Go to Settings</Text>
          </Pressable>
        </View>
      ) : loadState === "no_model" ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Ionicons name="download-outline" size={40} color={colors.textSecondary} />
          <Text className="text-base font-semibold text-center text-text-primary dark:text-text-dark-primary">
            Model not downloaded yet
          </Text>
          <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary">
            Download the AI model (~880 MB) to start chatting. Wi-Fi recommended.
          </Text>
          <Pressable
            onPress={() => router.push("/settings/ai-assistant" as never)}
            className="px-5 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
          >
            <Text className="text-sm font-semibold text-white">Download model</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Chat area */}
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          >
            {messages.length === 0 && (
              <View className="items-center pt-8 pb-4">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center mb-4"
                  style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}
                >
                  <Ionicons name="sparkles" size={28} color={accentColor} />
                </View>
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
                  Ask about your finances
                </Text>
                <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary">
                  Everything runs privately on your phone.
                </Text>
              </View>
            )}

            {messages.map((msg) => (
              <View
                key={msg.id}
                className={`mb-3 max-w-[85%] ${msg.role === "user" ? "self-end" : "self-start"}`}
              >
                <View
                  className="rounded-2xl px-4 py-3"
                  style={{
                    backgroundColor:
                      msg.role === "user"
                        ? ac(accent, colorScheme, 100, 800)
                        : colorScheme === "dark" ? "#1c2128" : "#f3f4f6",
                    borderBottomRightRadius: msg.role === "user" ? 4 : 16,
                    borderBottomLeftRadius: msg.role === "user" ? 16 : 4,
                  }}
                >
                  <Text
                    className="text-sm leading-6"
                    style={{
                      color: msg.role === "user"
                        ? ac(accent, colorScheme, 700, 100)
                        : colors.text,
                    }}
                  >
                    {msg.content}
                    {msg.streaming && (
                      <Text style={{ color: accentColor }}>▍</Text>
                    )}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Suggestion chips — only before first message */}
          {messages.length === 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6, gap: 8 }}
              className="flex-grow-0"
            >
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => sendMessage(s)}
                  className="border border-border-light dark:border-border-dark rounded-full px-3 py-2"
                  style={{ backgroundColor: colors.surface }}
                >
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {s}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Input bar */}
          <View
            className="flex-row items-end px-3 pb-6 pt-2 border-t border-border-light dark:border-border-dark"
            style={{ backgroundColor: colors.background }}
          >
            <TextInput
              className="flex-1 rounded-2xl px-4 py-3 mr-2 text-sm text-text-primary dark:text-text-dark-primary"
              style={{
                backgroundColor: colorScheme === "dark" ? "#1c2128" : "#f3f4f6",
                maxHeight: 120,
              }}
              placeholder="Ask about your finances…"
              placeholderTextColor={colors.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              multiline
              onSubmitEditing={() => sendMessage(inputText)}
              returnKeyType="send"
              blurOnSubmit={false}
              editable={!isGenerating}
            />
            <Pressable
              onPress={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isGenerating}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{
                backgroundColor:
                  inputText.trim() && !isGenerating ? accentColor : colors.border,
              }}
            >
              {isGenerating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
