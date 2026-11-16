import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { DateInput, Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { DatePreset, SavedFilterView } from "@/services/saved-filter-views";
import { DATE_PRESET_LABELS, DATE_PRESET_ORDER } from "@/services/saved-filter-views";

/** Everything the sheet edits. A draft until Apply: closing any other way changes nothing. */
export interface TxFilterDraft {
  sortBy: string;
  groupBy: string;
  datePreset: DatePreset;
  customStart: string;
  customEnd: string;
  categoryIds: string[];
  creditKinds: string[];
  /** Rupees as typed; "" for no limit. */
  minAmount: string;
  maxAmount: string;
  accountIds: string[];
  paymentModeIds: string[];
  status: "" | "pending_review" | "approved";
  tagIds: string[];
  merchantNames: string[];
  refundedStatus: "" | "refunded" | "not_refunded";
  avoidability: "" | "avoidable" | "unavoidable" | "unclassified";
  ruleIds: string[];
}

export interface FilterOption {
  id: string;
  label: string;
  /** Second line, e.g. an account's last digits. */
  sub?: string;
  color?: string;
}

type Nature = "realized" | "committed" | "credit" | "transfers" | "all";

type FieldKey =
  | "sort"
  | "group"
  | "date"
  | "category"
  | "amount"
  | "account"
  | "paymentMode"
  | "status"
  | "tags"
  | "merchant"
  | "refund"
  | "avoid"
  | "rule"
  | "views";

interface Field {
  key: FieldKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
}

export const DEFAULT_SORT = "date_desc";
export const DEFAULT_GROUP = "date";

/** How many things are on in each field: the badges on the rail and the Apply count. */
export function draftCounts(d: TxFilterDraft, defaultPreset: DatePreset): Record<FieldKey, number> {
  return {
    sort: d.sortBy !== DEFAULT_SORT ? 1 : 0,
    group: d.groupBy !== DEFAULT_GROUP ? 1 : 0,
    date: d.datePreset !== defaultPreset ? 1 : 0,
    category: d.categoryIds.length + d.creditKinds.length,
    amount: d.minAmount.trim() || d.maxAmount.trim() ? 1 : 0,
    account: d.accountIds.length,
    paymentMode: d.paymentModeIds.length,
    status: d.status ? 1 : 0,
    tags: d.tagIds.length,
    merchant: d.merchantNames.length,
    refund: d.refundedStatus ? 1 : 0,
    avoid: d.avoidability ? 1 : 0,
    rule: d.ruleIds.length,
    views: 0,
  };
}

export function draftTotal(d: TxFilterDraft, defaultPreset: DatePreset): number {
  return Object.values(draftCounts(d, defaultPreset)).reduce((a, b) => a + b, 0);
}

const AMOUNT_PRESETS: { label: string; min: string; max: string }[] = [
  { label: "Under ₹500", min: "", max: "500" },
  { label: "₹500 – 2,000", min: "500", max: "2000" },
  { label: "₹2,000 – 10,000", min: "2000", max: "10000" },
  { label: "Over ₹10,000", min: "10000", max: "" },
];

/** Long lists show this many until a search narrows them. */
const LIST_CAP = 60;

interface TransactionFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (draft: TxFilterDraft) => void;
  /** What's applied now; the draft starts from it each time the sheet opens. */
  value: TxFilterDraft;
  nature: Nature;
  defaultPreset: DatePreset;
  /** Opens on this field, e.g. the date when the range button was tapped. */
  initialField?: FieldKey;
  sortOptions: { value: string; label: string }[];
  groupOptions: { value: string; label: string }[];
  categories: FilterOption[];
  creditKinds: FilterOption[];
  accounts: FilterOption[];
  paymentModes: FilterOption[];
  tags: FilterOption[];
  merchants: FilterOption[];
  rules: FilterOption[];
  savedViews: SavedFilterView[];
  activeViewId: string | null;
  defaultViewId: string | null;
  onApplyView: (view: SavedFilterView) => void;
  onDeleteView: (view: SavedFilterView) => void;
  onToggleDefaultView: (view: SavedFilterView) => void;
}

/**
 * The Transactions filters in one bottom sheet, split 20 / 80: an icon rail on the left, every
 * setting in one scrolling column on the right. Tapping a rail item scrolls to its section;
 * scrolling moves the rail's highlight with you. Each rail item carries a count of what's on in it.
 */
export function TransactionFilterSheet(props: TransactionFilterSheetProps) {
  const { visible, onClose, onApply, value, nature, defaultPreset, initialField } = props;
  const theme = useTheme();
  const { height: winH } = useWindowDimensions();
  const [draft, setDraft] = useState<TxFilterDraft>(value);
  const [active, setActive] = useState<FieldKey>("sort");
  const [catQuery, setCatQuery] = useState("");
  const [merchantQuery, setMerchantQuery] = useState("");

  const paneRef = useRef<ScrollView>(null);
  const railRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<FieldKey, number>>>({});
  const railY = useRef<Partial<Record<FieldKey, { y: number; h: number }>>>({});
  const [paneH, setPaneH] = useState(0);
  const [railH, setRailH] = useState(0);
  // While a tap-to-jump scroll is running, the scroll handler leaves the highlight alone.
  const lockUntil = useRef(0);

  const isTransfers = nature === "transfers";
  const isCredit = nature === "credit";
  const isSpend = nature === "realized";

  const fields = useMemo<Field[]>(() => {
    if (isTransfers) {
      return [
        { key: "group", label: "Group", icon: "layers-outline", title: "Group by", hint: "How the list is arranged" },
        { key: "date", label: "Date", icon: "calendar-outline", title: "Date", hint: "Choose a range" },
      ];
    }
    const list: (Field | false)[] = [
      { key: "sort", label: "Sort", icon: "swap-vertical-outline", title: "Sort by", hint: "Pick one" },
      { key: "group", label: "Group", icon: "layers-outline", title: "Group by", hint: "How the list is arranged" },
      { key: "date", label: "Date", icon: "calendar-outline", title: "Date", hint: "Choose a range" },
      isCredit
        ? { key: "category", label: "Type", icon: "pricetags-outline", title: "Type", hint: "Select any" }
        : { key: "category", label: "Category", icon: "grid-outline", title: "Category", hint: "Select any" },
      { key: "amount", label: "Amount", icon: "cash-outline", title: "Amount", hint: "Set a range or pick one" },
      { key: "account", label: "Account", icon: "business-outline", title: "Account", hint: "Select any" },
      !isCredit && { key: "paymentMode", label: "Paid by", icon: "card-outline", title: "Payment mode", hint: "Select any" },
      { key: "status", label: "Status", icon: "checkmark-circle-outline", title: "Status", hint: "Pick one" },
      props.tags.length > 0 && { key: "tags", label: "Tags", icon: "pricetag-outline", title: "Tags", hint: "Select any" },
      { key: "merchant", label: isCredit ? "From" : "Merchant", icon: "storefront-outline", title: isCredit ? "Received from" : "Merchant", hint: "Select any" },
      isSpend && { key: "refund", label: "Refunds", icon: "return-down-back-outline", title: "Refunds", hint: "Pick one" },
      isSpend && { key: "avoid", label: "Need", icon: "scale-outline", title: "Unavoidable or discretionary", hint: "Pick one" },
      props.rules.length > 0 && { key: "rule", label: "Rules", icon: "flash-outline", title: "Smart rule", hint: "Transactions a rule changed" },
      props.savedViews.length > 0 && { key: "views", label: "Views", icon: "bookmark-outline", title: "Saved views", hint: "Applies straight away" },
    ];
    return list.filter((f): f is Field => !!f);
  }, [isTransfers, isCredit, isSpend, props.tags.length, props.rules.length, props.savedViews.length]);

  // Each opening starts from what's applied.
  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setCatQuery("");
    setMerchantQuery("");
    const start = initialField && fields.some((f) => f.key === initialField) ? initialField : fields[0]?.key ?? "date";
    setActive(start);
    sectionY.current = {};
    // After the sections have laid out, jump to the one asked for.
    if (start !== fields[0]?.key) {
      const t = setTimeout(() => {
        const y = sectionY.current[start];
        if (y != null) {
          lockUntil.current = Date.now() + 400;
          paneRef.current?.scrollTo({ y, animated: false });
        }
      }, 60);
      return () => clearTimeout(t);
    }
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the highlighted rail item in view when the column scrolls far.
  useEffect(() => {
    const r = railY.current[active];
    if (!r || railH === 0) return;
    railRef.current?.scrollTo({ y: Math.max(0, r.y - railH / 2 + r.h / 2), animated: true });
  }, [active, railH]);

  const set = useCallback(<K extends keyof TxFilterDraft>(key: K, v: TxFilterDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: v }));
  }, []);
  const toggleIn = useCallback((key: "categoryIds" | "creditKinds" | "accountIds" | "paymentModeIds" | "tagIds" | "merchantNames" | "ruleIds", id: string) => {
    setDraft((d) => {
      const list = d[key];
      return { ...d, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
    });
  }, []);

  const counts = draftCounts(draft, defaultPreset);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const clearAll = () =>
    setDraft((d) => ({
      ...d,
      sortBy: DEFAULT_SORT,
      groupBy: DEFAULT_GROUP,
      datePreset: defaultPreset,
      customStart: "",
      customEnd: "",
      categoryIds: [],
      creditKinds: [],
      minAmount: "",
      maxAmount: "",
      accountIds: [],
      paymentModeIds: [],
      status: "",
      tagIds: [],
      merchantNames: [],
      refundedStatus: "",
      avoidability: "",
      ruleIds: [],
    }));

  const jump = (key: FieldKey) => {
    setActive(key);
    const y = sectionY.current[key];
    if (y == null) return;
    lockUntil.current = Date.now() + 650;
    paneRef.current?.scrollTo({ y, animated: true });
  };

  const onPaneScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() < lockUntil.current) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const top = contentOffset.y;
    let next: FieldKey = fields[0].key;
    // Bottom of the column: the last section, even if it can't reach the top.
    if (top + layoutMeasurement.height >= contentSize.height - 4) {
      next = fields[fields.length - 1].key;
    } else {
      for (const f of fields) {
        const y = sectionY.current[f.key];
        if (y != null && y <= top + 32) next = f.key;
      }
    }
    if (next !== active) setActive(next);
  };

  const sheetH = Math.round(winH * 0.8);
  const accent = theme.primary;
  const tint = theme.alpha("primary", 0.1);

  const q = catQuery.trim().toLowerCase();
  const catList = (isCredit ? props.creditKinds : props.categories).filter((c) => !q || c.label.toLowerCase().includes(q));
  const mq = merchantQuery.trim().toLowerCase();
  const merchantMatches = props.merchants.filter((m) => !mq || m.label.toLowerCase().includes(mq));
  // Picked merchants stay visible even when the cap would hide them.
  const merchantShown = [
    ...merchantMatches.filter((m) => draft.merchantNames.includes(m.id)),
    ...merchantMatches.filter((m) => !draft.merchantNames.includes(m.id)),
  ].slice(0, Math.max(LIST_CAP, draft.merchantNames.length));

  const section = (key: FieldKey, children: React.ReactNode) => {
    const f = fields.find((x) => x.key === key);
    if (!f) return null;
    const last = fields[fields.length - 1].key === key;
    return (
      <View
        key={key}
        onLayout={(e: LayoutChangeEvent) => {
          sectionY.current[key] = e.nativeEvent.layout.y;
        }}
        className={`px-4 pt-4 pb-5 ${last ? "" : "border-b border-border"}`}
      >
        <Text className="text-body font-bold text-foreground">{f.title}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5 mb-3">{f.hint}</Text>
        {children}
      </View>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={88} draggable>
      <View style={{ height: sheetH, flexShrink: 1 }}>
        {/* Header */}
        <View className="flex-row items-center pl-5 pr-3 pb-2 border-b border-border" style={{ minHeight: 52 }}>
          <Text className="flex-1 text-xl font-bold text-foreground">Filters</Text>
          <Pressable
            onPress={clearAll}
            disabled={total === 0}
            hitSlop={6}
            className="px-3 justify-center"
            style={{ minHeight: 44 }}
            accessibilityRole="button"
            accessibilityState={{ disabled: total === 0 }}
          >
            <Text className="text-sm font-semibold" style={{ color: total === 0 ? theme.mutedForeground : accent }}>
              Clear all
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            className="items-center justify-center rounded-full ml-1"
            style={{ width: 40, height: 40, backgroundColor: theme.alpha("foreground", 0.06) }}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          >
            <Ionicons name="close" size={18} color={theme.foreground} />
          </Pressable>
        </View>

        {/* 20 / 80 */}
        <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
          <ScrollView
            ref={railRef}
            onLayout={(e) => setRailH(e.nativeEvent.layout.height)}
            style={{ width: "20%", flexGrow: 0, backgroundColor: theme.alpha("foreground", 0.035) }}
            contentContainerStyle={{ paddingVertical: 6 }}
            showsVerticalScrollIndicator={false}
            accessibilityRole="tablist"
          >
            {fields.map((f) => {
              const on = active === f.key;
              const n = counts[f.key];
              return (
                <Pressable
                  key={f.key}
                  onPress={() => jump(f.key)}
                  onLayout={(e) => {
                    railY.current[f.key] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                  }}
                  className="items-center py-2"
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={n > 0 ? `${f.title}, ${n} on` : f.title}
                >
                  <View
                    className="items-center justify-center"
                    style={{ width: 44, height: 32, borderRadius: 16, backgroundColor: on ? tint : "transparent" }}
                  >
                    <Ionicons name={f.icon} size={19} color={on ? accent : theme.mutedForeground} />
                    {n > 0 && (
                      <View
                        className="absolute items-center justify-center"
                        style={{
                          top: -4,
                          right: -2,
                          minWidth: 17,
                          height: 17,
                          paddingHorizontal: 4,
                          borderRadius: 9,
                          backgroundColor: accent,
                          borderWidth: 2,
                          borderColor: theme.card,
                        }}
                      >
                        <Text style={{ fontSize: 9, fontWeight: "700", color: theme.primaryForeground }}>{n}</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    className="text-center mt-1"
                    numberOfLines={1}
                    style={{ fontSize: 11, fontWeight: on ? "700" : "500", color: on ? theme.foreground : theme.mutedForeground }}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            ref={paneRef}
            style={{ flex: 1 }}
            onLayout={(e) => setPaneH(e.nativeEvent.layout.height)}
            onScroll={onPaneScroll}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="handled"
            // Room after the last section so every section can scroll up to the top.
            contentContainerStyle={{ paddingBottom: Math.max(120, paneH * 0.55) }}
          >
            {section(
              "sort",
              props.sortOptions.map((o) => (
                <RadioRow key={o.value} label={o.label} on={draft.sortBy === o.value} onPress={() => set("sortBy", o.value)} />
              )),
            )}

            {section(
              "group",
              props.groupOptions.map((o) => (
                <RadioRow key={o.value} label={o.label} on={draft.groupBy === o.value} onPress={() => set("groupBy", o.value)} />
              )),
            )}

            {section(
              "date",
              <>
                <ChipWrap>
                  {DATE_PRESET_ORDER.map((p) => (
                    <Chip
                      key={p}
                      label={DATE_PRESET_LABELS[p]}
                      on={draft.datePreset === p}
                      onPress={() => set("datePreset", p)}
                    />
                  ))}
                </ChipWrap>
                {draft.datePreset === "custom" && (
                  <View className="flex-row mt-3" style={{ gap: 10 }}>
                    <View className="flex-1">
                      <DateInput label="From" value={draft.customStart} onChange={(v) => set("customStart", v)} maximumDate={null} />
                    </View>
                    <View className="flex-1">
                      <DateInput label="To" value={draft.customEnd} onChange={(v) => set("customEnd", v)} maximumDate={null} />
                    </View>
                  </View>
                )}
              </>,
            )}

            {section(
              "category",
              <>
                {(isCredit ? props.creditKinds : props.categories).length > 8 && (
                  <SearchBox value={catQuery} onChange={setCatQuery} placeholder={isCredit ? "Search types" : "Search categories"} />
                )}
                {catList.map((c) => (
                  <CheckRow
                    key={c.id}
                    label={c.label}
                    color={c.color}
                    on={(isCredit ? draft.creditKinds : draft.categoryIds).includes(c.id)}
                    onPress={() => toggleIn(isCredit ? "creditKinds" : "categoryIds", c.id)}
                  />
                ))}
                {catList.length === 0 && <Empty text={q ? "Nothing matches" : "Nothing to pick yet"} />}
              </>,
            )}

            {section(
              "amount",
              <>
                <View className="flex-row" style={{ gap: 10 }}>
                  <AmountBox label="Min" placeholder="0" value={draft.minAmount} onChange={(v) => set("minAmount", v)} />
                  <AmountBox label="Max" placeholder="Any" value={draft.maxAmount} onChange={(v) => set("maxAmount", v)} />
                </View>
                <ChipWrap className="mt-3">
                  {AMOUNT_PRESETS.map((p) => {
                    const on = draft.minAmount === p.min && draft.maxAmount === p.max;
                    return (
                      <Chip
                        key={p.label}
                        label={p.label}
                        on={on}
                        onPress={() => setDraft((d) => ({ ...d, minAmount: on ? "" : p.min, maxAmount: on ? "" : p.max }))}
                      />
                    );
                  })}
                </ChipWrap>
              </>,
            )}

            {section(
              "account",
              <>
                {props.accounts.map((a) => (
                  <CheckRow key={a.id} label={a.label} sub={a.sub} on={draft.accountIds.includes(a.id)} onPress={() => toggleIn("accountIds", a.id)} />
                ))}
                {props.accounts.length === 0 && <Empty text="No accounts yet" />}
              </>,
            )}

            {section(
              "paymentMode",
              <ChipWrap>
                {props.paymentModes.map((p) => (
                  <Chip key={p.id} label={p.label} on={draft.paymentModeIds.includes(p.id)} onPress={() => toggleIn("paymentModeIds", p.id)} />
                ))}
              </ChipWrap>,
            )}

            {section(
              "status",
              <Segmented
                options={[
                  { value: "", label: "Any" },
                  { value: "pending_review", label: "Needs review" },
                  { value: "approved", label: "Approved" },
                ]}
                value={draft.status}
                onChange={(v) => set("status", v as TxFilterDraft["status"])}
              />,
            )}

            {section(
              "tags",
              <ChipWrap>
                {props.tags.map((t) => (
                  <Chip key={t.id} label={t.label} dot={t.color} on={draft.tagIds.includes(t.id)} onPress={() => toggleIn("tagIds", t.id)} />
                ))}
              </ChipWrap>,
            )}

            {section(
              "merchant",
              <>
                <SearchBox value={merchantQuery} onChange={setMerchantQuery} placeholder={isCredit ? "Search names" : "Search merchants"} />
                {merchantShown.map((m) => (
                  <CheckRow key={m.id} label={m.label} on={draft.merchantNames.includes(m.id)} onPress={() => toggleIn("merchantNames", m.id)} />
                ))}
                {merchantMatches.length > merchantShown.length && (
                  <Text className="text-xs text-muted-foreground mt-2">
                    {merchantMatches.length - merchantShown.length} more. Search to find them.
                  </Text>
                )}
                {merchantMatches.length === 0 && <Empty text={mq ? "Nothing matches" : "No merchants yet"} />}
              </>,
            )}

            {section(
              "refund",
              <Segmented
                options={[
                  { value: "", label: "Any" },
                  { value: "refunded", label: "Refunded" },
                  { value: "not_refunded", label: "Not refunded" },
                ]}
                value={draft.refundedStatus}
                onChange={(v) => set("refundedStatus", v as TxFilterDraft["refundedStatus"])}
              />,
            )}

            {section(
              "avoid",
              <ChipWrap>
                {(
                  [
                    { value: "unavoidable", label: "Unavoidable" },
                    { value: "avoidable", label: "Discretionary" },
                    { value: "unclassified", label: "Not classified" },
                  ] as const
                ).map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    on={draft.avoidability === o.value}
                    onPress={() => set("avoidability", draft.avoidability === o.value ? "" : o.value)}
                  />
                ))}
              </ChipWrap>,
            )}

            {section(
              "rule",
              <ChipWrap>
                {props.rules.map((r) => (
                  <Chip key={r.id} label={r.label} on={draft.ruleIds.includes(r.id)} onPress={() => toggleIn("ruleIds", r.id)} />
                ))}
              </ChipWrap>,
            )}

            {section(
              "views",
              <View className="rounded-xl border border-border overflow-hidden">
                {props.savedViews.map((v, i) => {
                  const isActive = props.activeViewId === v.id;
                  const isDefault = props.defaultViewId === v.id;
                  return (
                    <View key={v.id} className={`flex-row items-center ${i > 0 ? "border-t border-border" : ""}`}>
                      <Pressable
                        onPress={() => props.onApplyView(v)}
                        className="flex-1 flex-row items-center px-3"
                        style={{ minHeight: 48 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Apply ${v.name}`}
                      >
                        <Text className="flex-1 text-sm" numberOfLines={1} style={{ color: isActive ? accent : theme.foreground, fontWeight: isActive ? "700" : "500" }}>
                          {v.name}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => props.onToggleDefaultView(v)}
                        hitSlop={6}
                        className="px-2 justify-center"
                        style={{ minHeight: 48 }}
                        accessibilityRole="button"
                        accessibilityLabel={isDefault ? `Stop opening with ${v.name}` : `Open with ${v.name}`}
                      >
                        <Ionicons name={isDefault ? "star" : "star-outline"} size={16} color={isDefault ? theme.warning : theme.mutedForeground} />
                      </Pressable>
                      <Pressable
                        onPress={() => props.onDeleteView(v)}
                        hitSlop={6}
                        className="pl-2 pr-3 justify-center"
                        style={{ minHeight: 48 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${v.name}`}
                      >
                        <Ionicons name="trash-outline" size={16} color={theme.mutedForeground} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>,
            )}
          </ScrollView>
        </View>

        {/* Footer */}
        <View className="flex-row px-4 pt-3 border-t border-border" style={{ gap: 10 }}>
          <Pressable
            onPress={onClose}
            className="items-center justify-center rounded-2xl border border-border px-5"
            style={{ height: 48 }}
            accessibilityRole="button"
          >
            <Text className="text-body font-semibold text-foreground">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            className="flex-1 items-center justify-center rounded-2xl"
            style={{ height: 48, backgroundColor: accent }}
            accessibilityRole="button"
          >
            <Text className="text-body font-bold" style={{ color: theme.primaryForeground }}>
              {total === 0 ? "Show all transactions" : `Apply ${total} ${total === 1 ? "filter" : "filters"}`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

function ChipWrap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`flex-row flex-wrap ${className}`} style={{ gap: 8 }}>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress, dot }: { label: string; on: boolean; onPress: () => void; dot?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-full border px-3.5"
      style={{
        height: 36,
        borderColor: on ? theme.primary : theme.border,
        backgroundColor: on ? theme.alpha("primary", 0.1) : theme.card,
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      {dot ? <View className="rounded-full mr-1.5" style={{ width: 8, height: 8, backgroundColor: dot }} /> : null}
      <Text className="text-meta font-semibold" style={{ color: on ? theme.primary : theme.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RadioRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center" style={{ minHeight: 44, gap: 12 }} accessibilityRole="radio" accessibilityState={{ checked: on }}>
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 20, height: 20, borderWidth: 2, borderColor: on ? theme.primary : theme.alpha("foreground", 0.3) }}
      >
        {on && <View className="rounded-full" style={{ width: 10, height: 10, backgroundColor: theme.primary }} />}
      </View>
      <Text className="flex-1 text-sm font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

function CheckRow({ label, sub, on, onPress, color }: { label: string; sub?: string; on: boolean; onPress: () => void; color?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center"
      style={{ minHeight: sub ? 52 : 44, gap: 12 }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <View
        className="items-center justify-center rounded-md"
        style={{
          width: 20,
          height: 20,
          backgroundColor: on ? theme.primary : "transparent",
          borderWidth: on ? 0 : 2,
          borderColor: theme.alpha("foreground", 0.3),
        }}
      >
        {on && <Ionicons name="checkmark" size={14} color={theme.primaryForeground} />}
      </View>
      {color ? <View className="rounded-full" style={{ width: 8, height: 8, marginLeft: -4, backgroundColor: color }} /> : null}
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text className="text-xs text-muted-foreground mt-0.5">{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  return (
    <View className="flex-row rounded-xl p-1" style={{ gap: 4, backgroundColor: theme.alpha("foreground", 0.06) }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value || "any"}
            onPress={() => onChange(o.value)}
            className="flex-1 items-center justify-center rounded-lg px-1"
            style={{
              height: 38,
              backgroundColor: on ? theme.card : "transparent",
              elevation: on ? 1 : 0,
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text className="text-meta font-semibold text-center" numberOfLines={1} style={{ color: on ? theme.primary : theme.mutedForeground }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center rounded-xl border border-border px-3 mb-2" style={{ height: 42 }}>
      <Ionicons name="search" size={16} color={theme.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedForeground}
        className="flex-1 text-sm text-foreground ml-2"
        style={{ paddingVertical: 0 }}
        autoCorrect={false}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AmountBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  return (
    <View className="flex-1">
      <Text className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</Text>
      <View className="flex-row items-center rounded-xl border border-border px-3" style={{ height: 44 }}>
        <Text className="text-sm text-muted-foreground mr-1">₹</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ""))}
          placeholder={placeholder}
          placeholderTextColor={theme.mutedForeground}
          keyboardType="decimal-pad"
          className="flex-1 text-sm text-foreground"
          style={{ paddingVertical: 0 }}
          maxLength={12}
          accessibilityLabel={`${label} amount`}
        />
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text className="text-meta text-muted-foreground my-2">{text}</Text>;
}
