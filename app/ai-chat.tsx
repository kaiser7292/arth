import { useColorScheme } from "@/hooks/use-color-scheme";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import { Text } from "@/components/ui";
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
import { settingsStorage } from "@/services/storage";

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

const CHAT_HISTORY_KEY = "arth_ai_chat_history";
const MAX_STORED = 30;

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  failed?: boolean;
}

const SUGGESTIONS = [
  "How much did I spend this month?",
  "What's my biggest expense category?",
  "Am I over budget?",
  "Summarise last month's spending",
];

type LoadState = "checking" | "loading" | "ready" | "no_model" | "disabled";

// ── Simple markdown renderer ──────────────────────────────────────

function renderInlineParts(text: string, baseStyle: object): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  if (parts.length === 1) return <Text style={baseStyle}>{text}</Text>;
  return (
    <Text style={baseStyle}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={i} style={{ fontWeight: "700" }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text
              key={i}
              style={{
                fontFamily: Platform.OS === "android" ? "monospace" : "Courier",
                backgroundColor: "#00000020",
                borderRadius: 3,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function MessageContent({ text, textColor }: { text: string; textColor: string }) {
  const baseStyle = { color: textColor, fontSize: 14, lineHeight: 21 } as const;
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      if (i > 0 && i < lines.length - 1) {
        elements.push(<View key={`sp-${i}`} style={{ height: 6 }} />);
      }
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      elements.push(
        <Text key={i} style={{ ...baseStyle, fontWeight: "700", fontSize: 15, marginBottom: 2 }}>
          {headingMatch[1]}
        </Text>,
      );
      continue;
    }

    const bulletMatch = trimmed.match(/^[-•*]\s+(.+)/);
    if (bulletMatch) {
      elements.push(
        <View key={i} style={{ flexDirection: "row", marginBottom: 2 }}>
          <Text style={{ ...baseStyle, marginRight: 6 }}>{"•"}</Text>
          <View style={{ flex: 1 }}>{renderInlineParts(bulletMatch[1], baseStyle)}</View>
        </View>,
      );
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numMatch) {
      elements.push(
        <View key={i} style={{ flexDirection: "row", marginBottom: 2 }}>
          <Text style={{ ...baseStyle, marginRight: 6, minWidth: 22 }}>{numMatch[1]}.</Text>
          <View style={{ flex: 1 }}>{renderInlineParts(numMatch[2], baseStyle)}</View>
        </View>,
      );
      continue;
    }

    elements.push(
      <View key={i} style={{ marginBottom: 2 }}>
        {renderInlineParts(trimmed, baseStyle)}
      </View>,
    );
  }

  return <>{elements}</>;
}

// ─────────────────────────────────────────────────────────────────

export default function AIChatScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();

  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const isMounted = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted history on mount
  useEffect(() => {
    try {
      const stored = settingsStorage.getString(CHAT_HISTORY_KEY);
      if (stored) {
        const parsed: DisplayMessage[] = JSON.parse(stored);
        const cleaned = parsed.map((m) => ({ ...m, streaming: false, failed: false }));
        setMessages(cleaned);
        historyRef.current = cleaned.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      }
    } catch {}
  }, []);

  // Initialise model on mount
  useEffect(() => {
    isMounted.current = true;
    (async () => {
      if (!isArthAIEnabled()) { setLoadState("disabled"); return; }
      const downloaded = await isModelDownloaded();
      if (!downloaded) { setLoadState("no_model"); return; }
      setLoadState("loading");
      try {
        await initAIContext();
        if (isMounted.current) setLoadState("ready");
      } catch {
        if (isMounted.current) setLoadState("no_model");
      }
    })();
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") releaseAIContext();
    });
    return () => sub.remove();
  }, []);

  const saveHistory = useCallback((msgs: DisplayMessage[]) => {
    try {
      const toStore = msgs.filter((m) => !m.streaming && !m.failed).slice(-MAX_STORED);
      settingsStorage.set(CHAT_HISTORY_KEY, JSON.stringify(toStore));
    } catch {}
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    setRetryText(null);
    settingsStorage.delete(CHAT_HISTORY_KEY);
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const handleCopy = useCallback((id: string, text: string) => {
    Clipboard.setStringAsync(text);
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Core generation shared by sendMessage and retry
  const generate = useCallback(
    async (aiMsgId: string, userText: string) => {
      let fullText = "";
      let success = false;
      try {
        const dataContext = await buildAIDataContext({
          expenses: isAIDataExpensesEnabled(),
          accounts: isAIDataAccountsEnabled(),
          budget: isAIDataBudgetEnabled(),
          hisaab: isAIDataHisaabEnabled(),
          vault: isAIDataVaultEnabled(),
        });
        const trimmedHistory = historyRef.current.slice(-6);
        fullText = await chatWithAI(
          trimmedHistory,
          (token) => {
            if (!isMounted.current) return;
            fullText += token;
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullText } : m)),
            );
            scrollToBottom();
          },
          dataContext || undefined,
        );
        historyRef.current = [...historyRef.current, { role: "assistant", content: fullText }];
        success = true;
      } catch {
        if (isMounted.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: "Something went wrong. Tap Retry to try again.",
                    streaming: false,
                    failed: true,
                  }
                : m,
            ),
          );
          setRetryText(userText);
        }
      } finally {
        if (isMounted.current) {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === aiMsgId ? { ...m, streaming: false } : m,
            );
            if (success) saveHistory(updated);
            return updated;
          });
          setIsGenerating(false);
        }
      }
    },
    [scrollToBottom, saveHistory],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating || loadState !== "ready") return;

      const userMsg: DisplayMessage = { id: Date.now().toString(), role: "user", content: trimmed };
      const aiMsgId = (Date.now() + 1).toString();
      const aiMsg: DisplayMessage = { id: aiMsgId, role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];
      setInputText("");
      setRetryText(null);
      setIsGenerating(true);
      scrollToBottom();

      await generate(aiMsgId, trimmed);
    },
    [isGenerating, loadState, scrollToBottom, generate],
  );

  const retryLastMessage = useCallback(async () => {
    if (!retryText || isGenerating || loadState !== "ready") return;
    const text = retryText;
    setRetryText(null);

    const aiMsgId = Date.now().toString();
    // Replace failed AI message with a fresh streaming one
    setMessages((prev) => {
      const withoutFailed = prev.filter((m) => !m.failed);
      return [...withoutFailed, { id: aiMsgId, role: "assistant", content: "", streaming: true }];
    });
    setIsGenerating(true);
    scrollToBottom();

    await generate(aiMsgId, text);
  }, [retryText, isGenerating, loadState, scrollToBottom, generate]);

  const accentColor = theme.primary;
  const bubbleAiBg = colorScheme === "dark" ? "#1c2128" : "#f3f4f6";

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      {/* Header */}
      <View
        className="flex-row items-center px-4 pt-14 pb-3 border-b border-border"
        style={{ backgroundColor: colors.background }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} className="mr-3">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: theme.alpha("primary", 0.1) }}
        >
          <Ionicons name="sparkles" size={16} color={accentColor} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">
            Arth AI
          </Text>
          <Text
            className="text-xs"
            style={{ color: loadState === "ready" ? STATUS_COLORS.success : colors.textSecondary }}
          >
            {loadState === "ready"
              ? "On-device · private"
              : loadState === "loading"
              ? "Loading model…"
              : ""}
          </Text>
        </View>
        {messages.length > 0 && (
          <Pressable onPress={clearHistory} hitSlop={12}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Loading / error states */}
      {loadState === "checking" || loadState === "loading" ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={accentColor} />
          <Text className="text-sm text-muted-foreground">
            {loadState === "loading"
              ? "Loading AI model… (first time takes a few seconds)"
              : "Checking model…"}
          </Text>
        </View>
      ) : loadState === "disabled" ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Ionicons name="sparkles-outline" size={40} color={colors.textSecondary} />
          <Text className="text-base font-semibold text-center text-foreground">
            Arth AI is disabled
          </Text>
          <Text className="text-sm text-center text-muted-foreground">
            Enable it in Settings → Arth AI to get started.
          </Text>
          <Pressable
            onPress={() => router.push("/settings/ai-assistant" as never)}
            className="px-5 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
          >
            <Text className="text-sm font-semibold text-primary-foreground">Go to Settings</Text>
          </Pressable>
        </View>
      ) : loadState === "no_model" ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Ionicons name="download-outline" size={40} color={colors.textSecondary} />
          <Text className="text-base font-semibold text-center text-foreground">
            Model not downloaded yet
          </Text>
          <Text className="text-sm text-center text-muted-foreground">
            Download the AI model (~880 MB) to start chatting. Wi-Fi recommended.
          </Text>
          <Pressable
            onPress={() => router.push("/settings/ai-assistant" as never)}
            className="px-5 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
          >
            <Text className="text-sm font-semibold text-primary-foreground">Download model</Text>
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
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <Ionicons name="sparkles" size={28} color={accentColor} />
                </View>
                <Text className="text-base font-semibold text-foreground mb-1">
                  Ask about your finances
                </Text>
                <Text className="text-sm text-center text-muted-foreground">
                  Everything runs privately on your phone.
                </Text>
              </View>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const isCopied = copiedId === msg.id;
              const userBubbleBg = theme.alpha("primary", 0.1);
              const userTextColor = theme.primary as string;

              return (
                <View
                  key={msg.id}
                  className={`mb-4 max-w-[88%] ${isUser ? "self-end" : "self-start"}`}
                >
                  {/* Bubble */}
                  <View
                    className="rounded-2xl px-4 py-3"
                    style={{
                      backgroundColor: isUser ? userBubbleBg : bubbleAiBg,
                      borderBottomRightRadius: isUser ? 4 : 16,
                      borderBottomLeftRadius: isUser ? 16 : 4,
                    }}
                  >
                    {isUser ? (
                      <Text
                        className="text-sm leading-6"
                        style={{ color: userTextColor }}
                        selectable
                      >
                        {msg.content}
                      </Text>
                    ) : (
                      <>
                        <MessageContent
                          text={msg.content || (msg.streaming ? "" : "")}
                          textColor={colors.text}
                        />
                        {msg.streaming && (
                          <Text style={{ color: accentColor, fontSize: 14 }}>{"▍"}</Text>
                        )}
                      </>
                    )}
                  </View>

                  {/* Actions row — shown when not streaming */}
                  {!msg.streaming && (
                    <View
                      className={`flex-row items-center mt-1 gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {/* Retry button for failed AI messages */}
                      {!isUser && msg.failed && retryText && (
                        <Pressable
                          onPress={retryLastMessage}
                          className="flex-row items-center gap-1 px-2 py-1 rounded-lg"
                          style={{ backgroundColor: accentColor + "20" }}
                        >
                          <Ionicons name="refresh-outline" size={12} color={accentColor} />
                          <Text className="text-xs font-semibold" style={{ color: accentColor }}>
                            Retry
                          </Text>
                        </Pressable>
                      )}

                      {/* Copy button */}
                      {msg.content ? (
                        <Pressable
                          onPress={() => handleCopy(msg.id, msg.content)}
                          hitSlop={8}
                          className="flex-row items-center gap-1"
                        >
                          <Ionicons
                            name={isCopied ? "checkmark" : "copy-outline"}
                            size={13}
                            color={isCopied ? accentColor : colors.textSecondary}
                          />
                          {isCopied && (
                            <Text className="text-xs" style={{ color: accentColor }}>
                              Copied
                            </Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
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
                  className="border border-border rounded-full px-3 py-2"
                  style={{ backgroundColor: colors.surface }}
                >
                  <Text className="text-xs text-muted-foreground">
                    {s}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Input bar */}
          <View
            className="flex-row items-end px-3 pb-6 pt-2 border-t border-border"
            style={{ backgroundColor: colors.background }}
          >
            <TextInput
              className="flex-1 rounded-2xl px-4 py-3 mr-2 text-sm text-foreground"
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
