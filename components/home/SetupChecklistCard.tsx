import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, ProgressBar, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { closeSetupChecklist, getSetupSteps, isSetupChecklistClosed, type SetupStep } from "@/services/setup-checklist";

/** "Finish setting up" on Home: what's left, each a tap from its screen. Self-loading. */
export function SetupChecklistCard() {
  const router = useRouter();
  const theme = useTheme();
  const [steps, setSteps] = useState<SetupStep[] | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (isSetupChecklistClosed()) {
        setSteps(null);
        return;
      }
      const next = await getSetupSteps();
      if (next.every((s) => s.done)) {
        closeSetupChecklist();
        setSteps(null);
      } else {
        setSteps(next);
      }
    }, []),
  );

  if (!steps) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground">Finish setting up</Text>
        <Text className="text-xs text-muted-foreground">{doneCount} of {steps.length}</Text>
      </View>
      <ProgressBar value={doneCount / steps.length} color={theme.primary} height={5} animated={false} className="mt-2 mb-1" />
      {steps.map((step) => (
        <Pressable
          key={step.id}
          disabled={step.done}
          onPress={() => router.push(step.route as Href)}
          className="flex-row items-center py-2.5 border-t border-border"
          accessibilityRole="button"
          accessibilityState={{ checked: step.done, disabled: step.done }}
        >
          <Ionicons
            name={step.done ? "checkmark-circle" : "ellipse-outline"}
            size={18}
            color={step.done ? theme.success : theme.mutedForeground}
          />
          <Text
            className={`text-sm ml-2 flex-1 ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}
            numberOfLines={1}
          >
            {step.label}
          </Text>
          {!step.done && <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />}
        </Pressable>
      ))}
      <Pressable
        onPress={() => {
          closeSetupChecklist();
          setSteps(null);
        }}
        hitSlop={8}
        className="self-end pt-2"
        accessibilityRole="button"
      >
        <Text className="text-xs font-medium" style={{ color: theme.primary }}>Dismiss</Text>
      </Pressable>
    </Card>
  );
}
