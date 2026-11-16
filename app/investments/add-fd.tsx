import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/ui";
import { FDForm } from "@/components/account/FDForm";

/** Investments → Add fixed deposit. The form itself is shared with Add account (components/account/FDForm.tsx). */
export default function AddFDScreen() {
  const router = useRouter();
  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <FDForm onSaved={() => router.back()} />
      </ScrollView>
    </ScreenContainer>
  );
}
