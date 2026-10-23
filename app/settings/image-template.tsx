import { useCallback, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import type { ReceiptKind } from "@/services/receipt/read-receipt";
import {
  deleteImageTemplate,
  extractField,
  getImageTemplate,
  TEMPLATE_FIELDS,
  updateImageTemplate,
  type ImageTemplate,
  type TemplateField,
} from "@/services/receipt/image-templates";

const KINDS: { kind: ReceiptKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "credit", label: "Money in" },
  { kind: "transfer", label: "Transfer" },
  { kind: "committed", label: "EMI / SIP" },
];

/**
 * Edit a picture template (services/receipt/image-templates.ts): its name, what it records, and which
 * piece of its sample's text is each field. Templates saved before migration 085 kept no sample, so
 * their fields can only be removed - or the template re-taught with a new picture.
 */
export default function ImageTemplateScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [t, setT] = useState<ImageTemplate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<TemplateField | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (!id) return;
      const found = await getImageTemplate(id);
      setT(found);
      if (found) setName(found.name);
      setLoaded(true);
    }, [id]),
  );

  if (!t) {
    return (
      <ScreenContainer padTop={false}>
        {loaded && <Text className="text-sm text-muted-foreground p-4">This template no longer exists.</Text>}
      </ScreenContainer>
    );
  }

  const sample = t.sample;
  const label = (f: TemplateField) => {
    const d = TEMPLATE_FIELDS.find((x) => x.field === f)!;
    return t.kind === "credit" && d.creditLabel ? d.creditLabel : d.label;
  };
  const sampleValue = (f: TemplateField) => {
    const i = sample?.picks[f];
    return i != null ? sample?.pieces[i]?.text : undefined;
  };

  const saveName = () => {
    const n = name.trim();
    if (n && n !== t.name) void updateImageTemplate(t, { name: n });
    else setName(t.name);
  };

  const link = (f: TemplateField, i: number) => {
    if (!sample) return;
    const picks = { ...sample.picks };
    // A piece is one field: taking it from another field unlinks it there.
    for (const k of Object.keys(picks) as TemplateField[]) if (picks[k] === i) delete picks[k];
    picks[f] = i;
    setOpen(null);
    void updateImageTemplate(t, { picks });
  };

  const unlink = (f: TemplateField) => {
    setOpen(null);
    void updateImageTemplate(t, { removeField: f });
  };

  const remove = () =>
    alert("Delete this template?", `Pictures like "${t.name}" will be read the general way again.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteImageTemplate(t.id);
          router.back();
        },
      },
    ]);

  // With a sample every field can be linked; without one, only the ones it has can be removed.
  const shown = TEMPLATE_FIELDS.filter((d) => sample || t.fields[d.field]);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onBlur={saveName}
            onSubmitEditing={saveName}
            returnKeyType="done"
            className="text-base text-foreground rounded-lg px-3 py-2 border border-border"
            accessibilityLabel="Template name"
          />
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Records as</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {KINDS.map((k) => {
              const on = t.kind === k.kind;
              return (
                <Pressable
                  key={k.kind}
                  onPress={() => !on && void updateImageTemplate(t, { kind: k.kind })}
                  className="rounded-full px-4 py-2"
                  style={{ borderWidth: 1.5, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text className="text-sm font-semibold" style={{ color: on ? theme.primary : theme.foreground }}>{k.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs text-muted-foreground mt-2">Used {t.useCount} {t.useCount === 1 ? "time" : "times"}</Text>
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Fields</Text>
          <Text className="text-xs text-muted-foreground mb-2">
            {sample
              ? "Tap a field to link it to different text from the picture this template was taught on."
              : "This template was saved before editing was possible, so it has no text to re-link. You can remove a field, or re-teach it with a new picture below."}
          </Text>
          {shown.map((d) => {
            const has = !!t.fields[d.field];
            const value = sampleValue(d.field);
            const expanded = open === d.field;
            return (
              <View key={d.field} className="border-t border-border">
                <Pressable
                  onPress={() => setOpen(expanded ? null : d.field)}
                  className="flex-row items-center py-3"
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <Text className="text-sm text-foreground" style={{ width: 130 }}>{label(d.field)}</Text>
                  <Text className="text-sm flex-1 text-right" numberOfLines={1} style={{ color: has ? theme.foreground : theme.mutedForeground }}>
                    {has ? (value ?? "Linked") : "Not linked"}
                  </Text>
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} style={{ marginLeft: 6 }} />
                </Pressable>
                {expanded && (
                  <View className="pb-3">
                    {sample && (
                      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                        {sample.pieces.map((p, i) => {
                          if (!extractField(d.field, p.text)) return null;
                          const on = sample.picks[d.field] === i;
                          return (
                            <Pressable
                              key={i}
                              onPress={() => !on && link(d.field, i)}
                              className="rounded-md px-2 py-1.5"
                              style={{ borderWidth: 1, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined, maxWidth: "100%" }}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: on }}
                            >
                              <Text className="text-xs" numberOfLines={1} style={{ color: on ? theme.primary : theme.foreground }}>{p.text}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    {has && (
                      <Pressable onPress={() => unlink(d.field)} className="mt-2 self-start" accessibilityRole="button">
                        <Text className="text-sm font-medium" style={{ color: theme.danger }}>Remove this field</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </Card>

        <Button
          title="Re-teach with a new picture"
          variant="outline"
          onPress={() => router.push({ pathname: "/expense/from-screenshot", params: { templateId: t.id } })}
        />
        <Text className="text-xs text-muted-foreground text-center mt-2 mb-4">Pick a picture like it and link its text again; this template is updated.</Text>
        <Button title="Delete template" variant="ghost" onPress={remove} />
      </ScrollView>
    </ScreenContainer>
  );
}
