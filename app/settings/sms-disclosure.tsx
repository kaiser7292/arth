import { useState } from "react";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/ui";
import { SmsDisclosure } from "@/components/sms/SmsDisclosure";
import { useAlert } from "@/hooks/use-alert";
import { acceptSmsDisclosure, enableSmsDetection } from "@/services/sms/sms-permissions";
import { logger } from "@/utils/logger";

/** Full-screen SMS disclosure opened from the Settings "Read bank SMS" toggle. */
export default function SmsDisclosureScreen() {
  const router = useRouter();
  const alert = useAlert();
  const [requesting, setRequesting] = useState(false);

  const handleAccept = async () => {
    setRequesting(true);
    let granted = false;
    try {
      acceptSmsDisclosure();
      granted = await enableSmsDetection();
    } catch (e) {
      logger.warn("enableSmsDetection from settings failed:", e);
    }
    setRequesting(false);
    if (granted) {
      router.back();
    } else {
      alert(
        "Permission Denied",
        "SMS reading requires SMS permission. You can allow it from Android settings → Apps → Arth → Permissions.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <SmsDisclosure
        onAccept={handleAccept}
        onDecline={() => router.back()}
        accepting={requesting}
      />
    </ScreenContainer>
  );
}
