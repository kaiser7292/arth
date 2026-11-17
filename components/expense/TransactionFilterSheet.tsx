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
import { CheckRow, Chip, ChipWrap, DateInput, RadioRow, SearchField, SectionTitle, Segmented, Sheet, Text } from "@/components/ui";
import { FilterRailItem, FilterSheetFooter, FilterSheetHeader, applyLabelFor } from "@/components/ui/FilterSheetParts";
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
  /**
   * How many transactions the draft would show, for the Apply button ("Show 24 transactions").
   * Null when it can't be counted; the button then says "Apply".
   */
  countFor?: (draft: TxFilterDraft) => Promise<number | null>;
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

  // What Apply would show. Debounced: typing an amount shouldn't run a query per keystroke.
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const countFor = props.countFor;
  useEffect(() => {
    if (!visible || !countFor) return;
    let live = true;
    const t = setTimeout(() => {
      countFor(draft)
        .then((n) => live && setMatchCount(n))
        .catch(() => live && setMatchCount(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [visible, draft, countFor]);

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
        <SectionTitle
          icon={f.icon}
          title={f.title}
          hint={counts[key] > 0 ? `${f.hint} · ${counts[key]} on` : f.hint}
          active={counts[key] > 0}
          className="mb-3"
        />
        {children}
      </View>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={88} draggable>
      <View style={{ height: sheetH, flexShrink: 1 }}>
        <FilterSheetHeader onClear={clearAll} clearDisabled={total === 0} onClose={onClose} />

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
            {fields.map((f) => (
              <FilterRailItem
                key={f.key}
                label={f.label}
                title={f.title}
                icon={f.icon}
                count={counts[f.key]}
                on={active === f.key}
                onPress={() => jump(f.key)}
                onLayout={(e) => {
                  railY.current[f.key] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                }}
              />
            ))}
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
                  <SearchField className="mb-2" value={catQuery} onChangeText={setCatQuery} placeholder={isCredit ? "Search types" : "Search categories"} accessibilityLabel={isCredit ? "Search types" : "Search categories"} />
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
                <SearchField className="mb-2" value={merchantQuery} onChangeText={setMerchantQuery} placeholder={isCredit ? "Search names" : "Search merchants"} accessibilityLabel={isCredit ? "Search names" : "Search merchants"} />
                {merchantShown.map((m) => (
                  <CheckRow key={m.id} label={m.label} on={draft.merchantNames.includes(m.id)} onPress={() => toggleIn("merchantNames", m.id)} />
                ))}
                {merchantMatches.length > merchantShown.length && (
                  <Text className="text-meta text-muted-foreground mt-2">
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
              <View className="rounded-control border border-border overflow-hidden">
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
                        <Text className={`flex-1 text-body ${isActive ? "font-bold" : "font-medium"}`} numberOfLines={1} style={{ color: isActive ? accent : theme.foreground }}>
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

        <FilterSheetFooter
          onCancel={onClose}
          onApply={() => {
            onApply(draft);
            onClose();
          }}
          applyLabel={applyLabelFor(countFor ? matchCount : null, total)}
        />
      </View>
    </Sheet>
  );
}

function AmountBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  return (
    <View className="flex-1">
      <Text className="text-label font-semibold text-muted-foreground mb-1.5">{label}</Text>
      <View className="flex-row items-center rounded-control border border-border px-3" style={{ height: 44 }}>
        <Text className="text-body text-muted-foreground mr-1">₹</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ""))}
          placeholder={placeholder}
          placeholderTextColor={theme.mutedForeground}
          keyboardType="decimal-pad"
          className="flex-1 text-body text-foreground"
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
