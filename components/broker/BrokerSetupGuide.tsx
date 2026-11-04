import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text, useToast } from "@/components/ui";
import { BROKER_SETUP_GUIDES, type GuideField } from "@/constants/broker-setup-guides";
import { useTheme } from "@/hooks/use-theme";
import type { BrokerId } from "@/services/broker-terms";

/** Step-by-step setup on a connect screen. Open until the broker is connected. */
export function BrokerSetupGuide({ broker, connected }: { broker: BrokerId; connected: boolean }) {
  const theme = useTheme();
  const toast = useToast();
  // Read once: typing in the fields below mustn't fold the steps away.
  const [open, setOpen] = useState(!connected);
  const guide = BROKER_SETUP_GUIDES[broker];

  const copy = (field: GuideField) => {
    void Clipboard.setStringAsync(field.copy ?? "");
    toast(`${field.label} copied`);
  };

  let step = 0;
  return (
    <Card className="mb-3">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View className="flex-row items-center flex-1 mr-2">
          <Ionicons name="list-outline" size={16} color={theme.primary} />
          <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.primary }}>{guide.title}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.primary} />
      </Pressable>

      {open && (
        <View>
          {guide.sections.map((section) => (
            <View key={section.title} className="mt-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</Text>
              {section.intro && <Text className="text-xs text-muted-foreground leading-5 mt-1">{section.intro}</Text>}
              {section.steps.map((s) => {
                step += 1;
                return (
                  <View key={s.text} className="flex-row mt-3">
                    <Text className="text-sm font-semibold text-foreground" style={{ width: 22 }}>{step}.</Text>
                    <View className="flex-1">
                      <Text className="text-sm text-foreground leading-5">{s.text}</Text>
                      {s.fields?.map((field) => (
                        <View key={field.label} className="mt-2 p-2.5 rounded-lg" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
                          <Text className="text-xs font-semibold text-foreground">{field.label}</Text>
                          {field.copy && (
                            <View className="flex-row items-center mt-0.5">
                              <Text className="text-sm text-foreground flex-1 mr-3" selectable>{field.copy}</Text>
                              <Pressable
                                onPress={() => copy(field)}
                                hitSlop={8}
                                className="flex-row items-center"
                                accessibilityRole="button"
                                accessibilityLabel={`Copy ${field.label}`}
                              >
                                <Ionicons name="copy-outline" size={14} color={theme.primary} />
                                <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>Copy</Text>
                              </Pressable>
                            </View>
                          )}
                          {field.note && <Text className="text-xs text-muted-foreground leading-5 mt-0.5">{field.note}</Text>}
                        </View>
                      ))}
                      {s.link && (
                        <Pressable
                          onPress={() => void Linking.openURL(s.link!.url).catch(() => {})}
                          hitSlop={8}
                          className="flex-row items-center self-start mt-2"
                          accessibilityRole="link"
                        >
                          <Ionicons name="open-outline" size={14} color={theme.primary} />
                          <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>{s.link.label}</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          <Text className="text-xs text-muted-foreground leading-5 mt-4">{guide.ifItFails}</Text>
        </View>
      )}
    </Card>
  );
}
