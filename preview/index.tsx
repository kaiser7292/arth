import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterChip,
  Input,
  ListRow,
  ListSeparator,
  LoadingState,
  MetricRow,
  Money,
  ProgressBar,
  SectionHeader,
  SelectSheet,
  Sheet,
  Skeleton,
  StatusPill,
  Text,
} from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { TYPE } from "@/constants/design-tokens";

const ROLES = [
  "background", "card", "foreground", "mutedForeground", "faintForeground",
  "border", "primary", "primaryForeground", "accent", "accentSolid",
  "success", "danger", "warning",
] as const;

/**
 * Written out rather than built as `text-${k}`: Tailwind extracts class names statically from
 * source, so a class assembled at runtime is never generated and silently renders unstyled.
 */
const TYPE_CLASS: Record<keyof typeof TYPE, string> = {
  hero: "text-hero",
  display: "text-display",
  title: "text-title",
  heading: "text-heading",
  body: "text-body",
  meta: "text-meta",
  label: "text-label",
};

const PHONE = 390; // a common Android width; wide enough to be realistic, narrow enough to wrap

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View className="mb-8">
      <Text className="text-label font-semibold uppercase tracking-wider text-faint-foreground mb-1">
        {title}
      </Text>
      {note ? <Text className="text-meta text-muted-foreground mb-2">{note}</Text> : null}
      <View className="mt-1">{children}</View>
    </View>
  );
}

export default function Gallery() {
  const theme = useTheme();
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [sort, setSort] = useState<"a" | "b" | "c">("a");
  const [text, setText] = useState("");

  const dark = colorScheme === "dark";

  return (
    <View className="flex-1 bg-background" style={{ alignItems: "center" }}>
      {/* Harness chrome - not part of the app */}
      <View
        className="flex-row items-center justify-between w-full px-4 py-2 border-b border-border"
        style={{ maxWidth: PHONE }}
      >
        <Text className="text-meta font-semibold text-foreground">Arth design system</Text>
        <Pressable
          onPress={() => setColorScheme(dark ? "light" : "dark")}
          className="px-3 py-1.5 rounded-full"
          style={{ backgroundColor: theme.alpha("primary", 0.12) }}
        >
          <Text className="text-label font-semibold" style={{ color: theme.primary }}>
            {dark ? "Dark" : "Light"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ width: "100%", maxWidth: PHONE }}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Colour" note="Every semantic role, in the scheme shown above.">
          <View className="flex-row flex-wrap">
            {ROLES.map((r) => (
              <View key={r} className="mb-2 mr-2" style={{ width: 108 }}>
                <View
                  className="h-9 rounded-lg border border-border"
                  style={{ backgroundColor: theme[r] }}
                />
                <Text className="text-label text-muted-foreground mt-1" numberOfLines={1}>{r}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Type" note="Sizes come from TYPE in design-tokens. Wrapping here is real wrapping.">
          {(Object.keys(TYPE) as (keyof typeof TYPE)[]).map((k) => (
            <View key={k} className="flex-row items-baseline mb-1.5">
              <Text className="text-label text-faint-foreground" style={{ width: 64 }}>{k}</Text>
              <Text className={`${TYPE_CLASS[k]} text-foreground flex-1`} numberOfLines={1}>
                Groceries at Big Bazaar
              </Text>
            </View>
          ))}
          <View className="mt-2">
            <Text className="text-meta text-muted-foreground">Tabular figures line up in a column:</Text>
            {[125000, 9400.5, -1234.25, 76].map((v) => (
              <Money key={v} value={v} className="text-body text-foreground" />
            ))}
          </View>
        </Section>

        <Section title="Button">
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            <Button title="Primary" onPress={() => {}} />
            <Button title="Outline" variant="outline" onPress={() => {}} />
            <Button title="Disabled" onPress={() => {}} disabled />
          </View>
        </Section>

        <Section title="Badge" note="Semantic variants resolve through the theme.">
          <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
            <Badge label="Neutral" />
            <Badge label="Primary" variant="primary" />
            <Badge label="Success" variant="success" />
            <Badge label="Warning" variant="warning" />
            <Badge label="Danger" variant="danger" />
            <Badge label="SMS" variant="primary" uppercase />
            <Badge label="Solid" variant="primary" tone="solid" />
            <Badge label="Outline" variant="danger" tone="outline" />
            <Badge label={7} variant="accent" />
            <StatusPill label="StatusPill" color={theme.success} icon="checkmark-circle" />
          </View>
        </Section>

        <Section title="Card / rows" note="The Card header is one of the four deferred moves onto the scale.">
          <Card title="This month">
            <MetricRow label="Closing balance" value="₹1,25,000" />
            <MetricRow label="Spent this cycle" value="₹18,240" />
          </Card>
          <View className="mt-3 rounded-xl bg-card overflow-hidden">
            <ListRow icon="business-outline" title="Bank accounts" subtitle="4 active" onPress={() => {}} />
            <ListSeparator />
            <ListRow icon="card-outline" title="Credit cards" subtitle="2 active" onPress={() => {}} />
            <ListSeparator />
            <ListRow icon="wallet-outline" title="Wallets" subtitle="1 active" onPress={() => {}} />
          </View>
        </Section>

        <Section title="Ledger row" note="The composition that has broken most often - title, meta line, badges, amount.">
          <Card>
            {[
              { d: "Swiggy", m: "5 Sep · ···· 4412", a: -845, tags: ["SMS"] },
              { d: "Salary credited from Acme Corp Pvt Ltd", m: "1 Sep", a: 185000, tags: [] },
              { d: "Transfer to HDFC Savings", m: "3 Sep", a: -25000, tags: ["TRANSFER"] },
            ].map((r, i) => (
              <View key={i} className="flex-row items-center py-2.5">
                <View className="flex-1 mr-2">
                  <Text className="text-meta text-foreground" numberOfLines={1}>{r.d}</Text>
                  <View className="flex-row items-center mt-0.5">
                    <Text className="text-label text-muted-foreground">{r.m}</Text>
                    {r.tags.map((t) => (
                      <Badge key={t} label={t} variant="primary" className="ml-1.5" />
                    ))}
                  </View>
                </View>
                <Money
                  value={r.a}
                  showPlus={r.a > 0}
                  className="text-meta font-bold"
                  style={{ color: r.a < 0 ? theme.danger : theme.success }}
                />
              </View>
            ))}
          </Card>
        </Section>

        <Section title="Numeric table" note="The YoY / Compare shape: label, two figures, a change column.">
          <Card>
            <View className="flex-row mb-1.5">
              <View className="flex-1" />
              <Text className="w-20 text-label font-semibold text-faint-foreground text-right">FY 2025-26</Text>
              <Text className="w-20 ml-2 text-label font-semibold text-faint-foreground text-right">FY 2026-27</Text>
              <Text className="w-16 ml-2 text-label font-semibold text-faint-foreground text-right">Change</Text>
            </View>
            {[["Planned", "₹12,00,000", "₹14,40,000", "+20%"],
              ["Actual", "₹11,42,300", "₹15,08,900", "+32%"]].map((row) => (
              <View key={row[0]} className="flex-row items-center py-1.5">
                <Text className="flex-1 text-xs text-muted-foreground">{row[0]}</Text>
                <Text className="w-20 text-xs text-muted-foreground text-right">{row[1]}</Text>
                <Text className="w-20 ml-2 text-xs font-medium text-foreground text-right">{row[2]}</Text>
                <View className="w-16 ml-2 items-end">
                  <Badge label={row[3]} variant="success" />
                </View>
              </View>
            ))}
          </Card>
        </Section>

        <Section title="Progress">
          <ProgressBar value={0.22} height={6} animated={false} />
          <View className="h-2" />
          <ProgressBar value={0.68} color={theme.warning} height={8} animated={false} />
          <View className="h-2" />
          <ProgressBar value={1.4} color={theme.danger} height={12} animated={false} />
          <Text className="text-label text-muted-foreground mt-1">
            The last one is passed 140% - it clamps instead of overflowing its track.
          </Text>
        </Section>

        <Section title="Input / chips" note="Input box, its label, its hint and the chip label are the other three.">
          <Input
            label="Actual available"
            value={text}
            onChangeText={setText}
            placeholder="e.g. 1,55,000"
            formula
          />
          <Input
            label="Amount"
            value="abc"
            onChangeText={() => {}}
            error="Enter a valid amount"
          />
          <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
            <FilterChip label="All" active onPress={() => {}} />
            <FilterChip label="Committed" onPress={() => {}} />
            <FilterChip label="Credits" onPress={() => {}} />
          </View>
        </Section>

        <Section title="States">
          <AlertBanner severity="info" message="3 transactions need review, detected from SMS since your last scan." />
          <View className="h-2" />
          <AlertBanner severity="warning" message="Two accounts have no opening balance set." />
          <View className="h-3" />
          <Card><Skeleton width="60%" height={14} /><View className="h-2" /><LoadingState rows={3} /></Card>
          <View className="h-3" />
          <EmptyState icon="receipt-outline" title="No transactions" subtitle="Nothing recorded for this month yet." />
        </Section>

        <Section title="Sheets" note="Tap to open. Drag the handle to dismiss.">
          <View className="flex-row" style={{ gap: 8 }}>
            <Button title="Sheet" onPress={() => setSheetOpen(true)} />
            <Button title="SelectSheet" variant="outline" onPress={() => setSelectOpen(true)} />
          </View>
        </Section>

        <SectionHeader title="End of gallery" />
      </ScrollView>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <View className="px-5 pb-4">
          <Text className="text-heading font-bold text-foreground">A sheet</Text>
          <Text className="text-meta text-muted-foreground mt-1">
            Pinned to the bottom, capped in pixels, dragged by the handle only.
          </Text>
          <Button title="Close" onPress={() => setSheetOpen(false)} className="mt-4" />
        </View>
      </Sheet>

      <SelectSheet
        visible={selectOpen}
        title="Sort by"
        options={[
          { value: "a", label: "Date (newest first)", icon: "calendar-outline" },
          { value: "b", label: "Amount (highest first)", icon: "trending-down-outline" },
          { value: "c", label: "Alphabetical (A–Z)", icon: "text-outline" },
        ]}
        value={sort}
        onChange={setSort}
        onClose={() => setSelectOpen(false)}
      />
    </View>
  );
}
