import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, ScreenContainer, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { listImageTemplates, TEMPLATE_FIELDS, type ImageTemplate } from "@/services/receipt/image-templates";

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
  const theme = useTheme();
  const [templates, setTemplates] = useState<ImageTemplate[] | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setTemplates(await listImageTemplates());
    }, []),
  );

  // Pick a payment picture, then link its text to the fields and save.
  const addTemplate = () => router.push({ pathname: "/expense/from-screenshot", params: { teach: "1" } });

  if (templates && templates.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon="images-outline"
          title="No picture templates yet"
          subtitle="Pick a payment picture and link its text to the fields: amount, who was paid, date and so on. Arth then reads pictures like it the same way every time."
          action={<Button title="Add a template" onPress={addTemplate} className="mt-4" />}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-sm text-muted-foreground mb-3 leading-5">
          Payment picture layouts you taught Arth. A picture that matches one is read with it. Tap one to rename it, change
          its fields or delete it.
        </Text>
        <Button title="Add a template" variant="outline" onPress={addTemplate} className="mb-4" />
        {(templates ?? []).map((t) => (
          <Pressable
            key={t.id}
            onPress={() => router.push({ pathname: "/settings/image-template", params: { id: t.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${t.name}`}
          >
          <Card className="mb-3">
            <View className="flex-row items-start">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">{t.name}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {KIND_LABEL[t.kind]} · used {t.useCount} {t.useCount === 1 ? "time" : "times"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
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
          </Pressable>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
