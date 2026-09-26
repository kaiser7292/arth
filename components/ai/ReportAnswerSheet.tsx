import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Button, Input, Sheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import {
  AI_REPORT_EMAIL,
  AI_REPORT_REASONS,
  buildAIReportMailto,
  type AIReportReason,
} from "@/services/ai-report";

interface ReportAnswerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called after the email app opened, so the chat can mark the answer as reported. */
  onReported: () => void;
  question: string | null;
  answer: string;
  modelName: string;
  appVersion: string;
}

export function ReportAnswerSheet({
  visible,
  onClose,
  onReported,
  question,
  answer,
  modelName,
  appVersion,
}: ReportAnswerSheetProps) {
  const theme = useTheme();
  const alert = useAlert();
  const [reason, setReason] = useState<AIReportReason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote("");
    }
  }, [visible]);

  const handleSend = async () => {
    if (!reason) return;
    const url = buildAIReportMailto({ reason, note, question, answer, modelName, appVersion });
    try {
      await Linking.openURL(url);
      onReported();
      onClose();
    } catch {
      alert("No email app", `Couldn't open an email app. You can send the report to ${AI_REPORT_EMAIL}.`);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-6">
        <Text className="text-lg font-semibold text-foreground mb-1">Report this answer</Text>
        <Text className="text-sm text-muted-foreground mb-4 leading-5">
          Tell the developer about an answer that was offensive, harmful or wrong.
        </Text>

        {AI_REPORT_REASONS.map((r) => {
          const selected = reason === r.id;
          return (
            <Pressable
              key={r.id}
              onPress={() => setReason(r.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="flex-row items-center py-3 border-b border-border"
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? theme.primary : theme.mutedForeground}
                style={{ marginRight: 12 }}
              />
              <Text className="text-sm text-foreground">{r.label}</Text>
            </Pressable>
          );
        })}

        <Input
          placeholder="Add a note (optional)"
          value={note}
          onChangeText={setNote}
          multiline
          containerClassName="mt-4"
        />

        <Text className="text-xs text-muted-foreground mt-3 mb-4 leading-4">
          This opens your email app with the report, including your question and Arth AI's
          answer, which may contain financial details. You can edit it before sending. Nothing
          is sent until you tap Send.
        </Text>

        <Button title="Send report" onPress={handleSend} disabled={!reason} />
      </View>
    </Sheet>
  );
}
