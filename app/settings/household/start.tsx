import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { startHousehold } from "@/services/household/household";
import { formatError } from "@/utils/error-message";

/** Start a household: its name and how the others will see you. Then straight to inviting. */
export default function StartHouseholdScreen() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("Home");
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!me.trim()) {
      toast("Enter your name, as the others will see it", { tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      await startHousehold(name, me);
      router.replace("/settings/household/invite");
    } catch (e) {
      toast(formatError("Start household", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text className="text-sm text-muted-foreground mb-4 leading-5">
          You&apos;ll be the one who invites and approves people. Nothing is shared until you choose what to share.
        </Text>
        <Input label="Household name" value={name} onChangeText={setName} placeholder="Home" maxLength={40} />
        <View className="h-3" />
        <Input label="Your name" value={me} onChangeText={setMe} placeholder="Sourav" maxLength={40} autoFocus />
        <Text className="text-xs text-muted-foreground mt-1">How the others in the household will see you.</Text>
        <Button title="Start and invite" onPress={() => void start()} loading={busy} className="mt-6" />
      </ScrollView>
    </ScreenContainer>
  );
}
