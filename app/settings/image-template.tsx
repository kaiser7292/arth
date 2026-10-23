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
  pickText,
  TEMPLATE_FIELDS,
  updateImageTemplate,
  type ImageTemplate,
  type TemplateField,
  type TextPick,
  wordsOf,
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
    const pk = sample?.picks[f];
    return pk && sample ? (pickText(sample.pieces, pk) ?? undefined) : undefined;
  };
  const samePick = (a: TextPick | undefined, b: TextPick) => !!a && a.i === b.i && a.from === b.from && a.to === b.to;

  // What a field can be linked to: each line of the sample, and each word of a line with several.
  const options: { pick: TextPick; text: string }[] = sample
    ? sample.pieces.flatMap((p, i) => {
        const words = wordsOf(p);
        return [
          { pick: { i }, text: p.text },
          ...(words.length > 1 ? words.map((w, j) => ({ pick: { i, from: j, to: j }, text: w.text })) : []),
        ];
      })
    : [];

  const saveName = () => {
    const n = name.trim();
    if (n && n !== t.name) void updateImageTemplate(t, { name: n });
    else setName(t.name);
  };

  const link = (f: TemplateField, pick: TextPick) => {
    if (!sample) return;
    const picks = { ...sample.picks };
    // The same text is one field: taking it from another field unlinks it there.
    for (const k of Object.keys(picks) as TemplateField[]) if (samePick(picks[k], pick)) delete picks[k];
    picks[f] = pick;
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
              ? "Tap a field to link it to different text from the picture this template was taught on: a whole line, or one word of it."
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
                        {options.map((o) => {
                          if (!extractField(d.field, o.text)) return null;
                          const on = samePick(sample.picks[d.field], o.pick);
                          return (
                            <Pressable
                              key={`${o.pick.i}:${o.pick.from ?? "all"}`}
                              onPress={() => !on && link(d.field, o.pick)}
                              className="rounded-md px-2 py-1.5"
                              style={{ borderWidth: 1, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined, maxWidth: "100%" }}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: on }}
                            >
                              <Text className="text-xs" numberOfLines={1} style={{ color: on ? theme.primary : theme.foreground }}>{o.text}</Text>
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
