/**
 * Prominent disclosure shown before the READ_SMS runtime prompt.
 *
 * Google Play requires apps that read SMS to explain, in-app and before the
 * OS dialog, what is read, why, and where it goes — with an explicit accept.
 * Used by onboarding (sms-consent) and Settings (settings/sms-disclosure).
 * Keep the wording in sync with the privacy policy.
 */
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { Button, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export const PRIVACY_POLICY_URL = "https://souravbaid.com/legal.html#privacy";

const SECTIONS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = [
  {
    icon: "pricetags-outline",
    title: "What Arth takes from them",
    body: "Amount, date, merchant, account or card last 4 digits, and balance.",
  },
  {
    icon: "flash-outline",
    title: "Why",
    body: "To add your transactions and keep account balances up to date without typing them in.",
  },
  {
    icon: "phone-portrait-outline",
    title: "Where it goes",
    body: "Nowhere. SMS are read and processed only on this phone. They are never uploaded, shared or sent to any server, including ours.",
  },
  {
    icon: "checkmark-done-outline",
    title: "Your control",
    body: "Every detected transaction waits in a review queue for your approval. You can turn SMS reading off any time in Settings.",
  },
];

interface SmsDisclosureProps {
  onAccept: () => void;
  onDecline: () => void;
  accepting?: boolean;
  /** Optional extra row under the decline link (onboarding's "Skip setup entirely"). */
  footer?: React.ReactNode;
}

export function SmsDisclosure({ onAccept, onDecline, accepting, footer }: SmsDisclosureProps) {
  const theme = useTheme();

  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-12 h-12 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: theme.primary + "1F" }}
        >
          <Ionicons name="mail-unread-outline" size={24} color={theme.primary} />
        </View>

        <Text className="text-2xl font-bold text-foreground mb-2">
          Allow Arth to read your SMS?
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          Arth reads the SMS messages on this phone to find bank, card and UPI transaction alerts.
          It keeps only messages from banks and payment services and ignores personal chats.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.title} className="flex-row items-start mb-4">
            <Ionicons
              name={s.icon}
              size={18}
              color={theme.primary}
              style={{ marginTop: 2, marginRight: 12 }}
            />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground mb-0.5">{s.title}</Text>
              <Text className="text-sm text-foreground leading-5">{s.body}</Text>
            </View>
          </View>
        ))}

        <Pressable
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          accessibilityRole="link"
          className="self-start py-1"
        >
          <Text className="text-sm font-semibold text-primary">Privacy policy</Text>
        </Pressable>
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Agree and continue" onPress={onAccept} loading={accepting} className="mb-3" />
        <Pressable onPress={onDecline} className="py-2 items-center mb-1">
          <Text className="text-sm text-muted-foreground">No thanks</Text>
        </Pressable>
        {footer}
      </View>
    </>
  );
}
