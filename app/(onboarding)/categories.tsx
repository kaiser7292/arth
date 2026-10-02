import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { OnboardingStep } from "@/components/onboarding/OnboardingStep";
import { Input, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { createCategory, getAllCategories, updateCategory, type Category } from "@/services/category";
import { getErrorMessage } from "@/utils/error-message";

/** Onboarding: keep the categories you'll use, hide the rest, add your own. */
export default function OnboardingCategories() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    const all = await getAllCategories(DEFAULT_USER_ID);
    setCategories(all.filter((c) => c.name !== "Unknown"));
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const toggle = async (c: Category, on: boolean) => {
    setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: on ? 1 : 0 } : x)));
    try {
      await updateCategory(c.id, { is_active: on ? 1 : 0 });
    } catch (e) {
      alert("Couldn't update", getErrorMessage(e, "Please try again."));
      load().catch(() => {});
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      alert("Already there", `You already have a "${name}" category.`);
      return;
    }
    try {
      await createCategory({ user_id: DEFAULT_USER_ID, name });
      setNewName("");
      await load();
    } catch (e) {
      alert("Couldn't add", getErrorMessage(e, "Please try again."));
    }
  };

  const next = () => router.push("/(onboarding)/income");

  return (
    <OnboardingStep
      icon="grid-outline"
      title="Your categories"
      subtitle="Arth starts with these. Switch off the ones you won't use and add your own. You can change them any time in Settings → Categories."
      onPrimary={next}
      onSkipStep={next}
    >
      {categories.map((c) => (
        <View key={c.id} className="flex-row items-center py-2.5 border-b border-border">
          <Ionicons
            name={(c.icon as keyof typeof Ionicons.glyphMap) || "ellipse-outline"}
            size={18}
            color={c.is_active ? c.color : theme.mutedForeground}
            style={{ marginRight: 12 }}
          />
          <Text className="flex-1 text-sm text-foreground" style={{ opacity: c.is_active ? 1 : 0.5 }}>
            {c.name}
          </Text>
          <Switch value={c.is_active === 1} onValueChange={(v) => toggle(c, v)} accessibilityLabel={`Use ${c.name}`} />
        </View>
      ))}

      <View className="flex-row items-center mt-4" style={{ gap: 8 }}>
        <View className="flex-1">
          <Input placeholder="Add a category, e.g. Pets" value={newName} onChangeText={setNewName} onSubmitEditing={add} />
        </View>
        <Pressable onPress={add} hitSlop={8} accessibilityLabel="Add category" disabled={!newName.trim()}>
          <Ionicons name="add-circle" size={32} color={newName.trim() ? theme.primary : theme.mutedForeground} />
        </Pressable>
      </View>
    </OnboardingStep>
  );
}
