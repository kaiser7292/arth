import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Button, Input, Sheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { getCurrentAppVersion } from "@/services/onboarding";
import { buildSmsReportMailto, redactSms, SMS_REPORT_EMAIL } from "@/services/sms/sms-redact";

interface SendSmsToDeveloperSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Raw SMS body — redacted before it's shown. */
  body: string;
  sender: string;
}

/**
 * "Help Arth read this message": shows the SMS with names, account numbers, balances and
 * references hidden, lets the user edit it further, then opens their email app addressed to
 * the developer. Arth sends nothing itself.
 */
export function SendSmsToDeveloperSheet({ visible, onClose, body, sender }: SendSmsToDeveloperSheetProps) {
  const alert = useAlert();
  const [text, setText] = useState("");

  useEffect(() => {
    if (visible) setText(redactSms(body));
  }, [visible, body]);

  const send = async () => {
    try {
      await Linking.openURL(buildSmsReportMailto(text, sender, getCurrentAppVersion()));
      onClose();
    } catch {
      alert("No email app", `Couldn't open an email app. You can send the message to ${SMS_REPORT_EMAIL}.`);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-6">
        <Text className="text-lg font-semibold text-foreground mb-1">Help Arth read this message</Text>
        <Text className="text-sm text-muted-foreground mb-4 leading-5">
          Personal details are hidden. Check it and edit anything else you'd rather not share.
        </Text>
        <Input value={text} onChangeText={setText} multiline containerClassName="mb-3" />
        <Text className="text-xs text-muted-foreground mb-4 leading-4">
          Opens your email app addressed to {SMS_REPORT_EMAIL}. Nothing is sent until you tap Send there.
        </Text>
        <Button title="Open email app" onPress={() => void send()} />
      </View>
    </Sheet>
  );
}
