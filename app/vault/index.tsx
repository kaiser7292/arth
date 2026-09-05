import { useRouter } from "expo-router";
import { FAB, ScreenContainer } from "@/components/ui";
import { VaultPage } from "@/components/home/pages/VaultPage";

/**
 * Vault route.
 *
 * All of the list lives in VaultPage, which the Home swipe-pager also renders. This file used to
 * be a 196-line near-copy of it; the two differed only in chrome and in which of them anyone
 * remembered to update.
 */
export default function VaultIndexScreen() {
  const router = useRouter();

  return (
    <ScreenContainer padTop={false}>
      <VaultPage />
      <FAB icon="add" onPress={() => router.push("/vault/add")} />
    </ScreenContainer>
  );
}
