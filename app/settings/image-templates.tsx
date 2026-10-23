import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, ScreenContainer, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { deleteImageTemplate, listImageTemplates, TEMPLATE_FIELDS, type ImageTemplate } from "@/services/receipt/image-templates";

const KIND_LABEL: Record<ImageTemplate["kind"], string> = {
  expense: "Expense",
  credit: "Money in",
  transfer: "Transfer",
  committed: "EMI / SIP",
};

/**
 * Picture templates: payment picture layouts the user taught Arth on "Add from a picture" by tapping
 * the values (services/receipt/image-templates.ts). Listed here to see what each reads, and to delete.
 */
export default function ImageTemplatesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const [templates, setTemplates] = useState<ImageTemplate[] | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setTemplates(await listImageTemplates());
    }, []),
  );

  const remove = (t: ImageTemplate) =>
    alert("Delete this template?", `Pictures like "${t.name}" will be read the general way again.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteImageTemplate(t.id) },
    ]);

  if (templates && templates.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon="images-outline"
          title="No picture templates yet"
          subtitle={'When a payment picture is read wrong, tap "Something missing or wrong?" and tap the values on it. Arth then reads that layout the same way every time.'}
          action={<Button title="Add from a picture" onPress={() => router.push("/expense/from-screenshot")} className="mt-4" />}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-sm text-muted-foreground mb-3 leading-5">
          Payment picture layouts you taught Arth. A picture that matches one is read with it; to change one, add a picture
          like it and tap "Fix the template".
        </Text>
        {(templates ?? []).map((t) => (
          <Card key={t.id} className="mb-3">
            <View className="flex-row items-start">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">{t.name}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {KIND_LABEL[t.kind]} · used {t.useCount} {t.useCount === 1 ? "time" : "times"}
                </Text>
              </View>
              <Pressable onPress={() => remove(t)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${t.name}`}>
                <Ionicons name="trash-outline" size={18} color={theme.danger} />
              </Pressable>
            </View>
            <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
              {TEMPLATE_FIELDS.filter((d) => t.fields[d.field]).map((d) => (
                <View key={d.field} className="rounded-md px-2 py-1" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                    {t.kind === "credit" && d.creditLabel ? d.creditLabel : d.label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
