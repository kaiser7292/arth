import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import type { ToolbarChoice } from "./ListToolbar";
import { useTheme } from "@/hooks/use-theme";
import { PickerSheet } from "@/components/expense/PickerSheet";

/**
 * "Grouped by Type ▾ sorted As listed ▾" under a list's search (board "Accounts"): says how the
 * list is laid out, and each pill changes it in one tap, without opening the full filter sheet.
 */
export function GroupSortLine({ group, sort }: { group?: ToolbarChoice<string>; sort?: ToolbarChoice<string> }) {
  const theme = useTheme();
  const [open, setOpen] = useState<"group" | "sort" | null>(null);
  if (!group && !sort) return null;
  const pill = (which: "group" | "sort", c: ToolbarChoice<string>) => {
    const label = c.options.find((o) => o.value === c.value)?.label ?? "";
    const on = which === "group" && c.value !== "none";
    return (
      <Pressable
        onPress={() => setOpen(which)}
        className="rounded-pill border flex-row items-center px-2.5"
        style={{ height: 28, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : theme.card }}
        accessibilityRole="button"
        accessibilityLabel={`${which === "group" ? "Grouped by" : "Sorted"} ${label}. Change`}
      >
        <Text className="text-meta font-semibold" style={{ color: on ? theme.primary : theme.foreground }} numberOfLines={1}>
          {label} ▾
        </Text>
      </Pressable>
    );
  };
  const current = open === "group" ? group : open === "sort" ? sort : undefined;
  return (
    <View className="flex-row flex-wrap items-center px-4 pb-2" style={{ gap: 8 }}>
      {group && (
        <>
          <Text className="text-meta text-muted-foreground">Grouped by</Text>
          {pill("group", group)}
        </>
      )}
      {sort && (
        <>
          <Text className="text-meta text-muted-foreground">sorted</Text>
          {pill("sort", sort)}
        </>
      )}
      {current ? (
        <PickerSheet
          visible
          onClose={() => setOpen(null)}
          title={open === "group" ? "Group by" : "Sort by"}
          sections={[{ key: "all", items: current.options.map((o) => ({ id: o.value, label: o.label })) }]}
          selectedId={current.value}
          onSelect={(id) => {
            setOpen(null);
            if (id) current.onChange(id);
          }}
          searchPlaceholder="Search"
          noun={{ one: "option", many: "options" }}
        />
      ) : null}
    </View>
  );
}
