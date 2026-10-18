import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, LoadingState, ScreenContainer, SelectSheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { DATA_HEX } from "@/constants/brand";
import { parseDateAny } from "@/services/sms/bank-patterns";
import { inferDirection } from "@/services/sms/money-signals";
import { normalizeSms } from "@/services/sms/sms-normalize";
import { resolveSenderBank } from "@/services/public-data/sms-template-matcher";
import { compileTemplate, type TaggedField, type TaggedSpan } from "@/services/sms/template-compiler";
import { startDraft } from "@/services/sms/template-draft-store";
import { findBacklogMatches, applyTemplateToBacklog } from "@/services/sms/template-backlog";
import { groupByFormat, guessSpans, senderCode, type FormatGroup } from "@/services/sms/template-guess";
import {
  createUserTemplate,
  listUnrecognisedSms,
  listUserTemplates,
  type UnrecognisedSmsRow,
  type UserSmsTemplate,
  type UserTxType,
} from "@/services/sms/user-sms-templates";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

const FIELD_META: Record<TaggedField, { label: string; color: string }> = {
  amount: { label: "Amount", color: DATA_HEX.series[5] },
  account: { label: "Account", color: DATA_HEX.series[3] },
  merchant: { label: "Merchant", color: DATA_HEX.series[1] },
  date: { label: "Date", color: DATA_HEX.series[2] },
  balance: { label: "Balance after", color: DATA_HEX.series[4] },
  ref: { label: "Reference", color: DATA_HEX.series[0] },
  counterparty: { label: "Other person", color: DATA_HEX.series[1] },
  other_account: { label: "Other account", color: DATA_HEX.series[3] },
};
/** Shown even when not found, so they can be added. */
const CORE_FIELDS: TaggedField[] = ["amount", "account", "merchant", "date", "balance"];

const TYPE_OPTIONS: { value: UserTxType; label: string }[] = [
  { value: "auto", label: "Work it out from the words" },
  { value: "debit", label: "Money out" },
  { value: "credit", label: "Money in" },
  { value: "refund", label: "Refund" },
];

/** Words of a message with their positions, for tap-to-pick. */
function words(body: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(body); m; m = re.exec(body)) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

/** "XX4821." -> just the part that belongs to the field, without trailing punctuation. */
function trimSpan(body: string, start: number, end: number): { start: number; end: number } {
  while (end > start && /[.,;:)]/.test(body[end - 1])) end--;
  while (start < end && /[(]/.test(body[start])) start++;
  return { start, end };
}

/**
 * Teaching Arth a message format, confirmation first: Arth guesses the fields from every message
 * in the group (services/sms/template-guess.ts), you check them, fix any one by tapping the right
 * words, and save. Saving reads the group's other messages straight away. "Something's off"
 * opens the full tag screen with the guess filled in.
 */
export default function ConfirmTemplateScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const params = useLocalSearchParams<{ key?: string; smsId?: string }>();

  const [groups, setGroups] = useState<FormatGroup<UnrecognisedSmsRow>[] | null>(null);
  const [templates, setTemplates] = useState<UserSmsTemplate[]>([]);
  const [group, setGroup] = useState<FormatGroup<UnrecognisedSmsRow> | null>(null);
  const [spans, setSpans] = useState<TaggedSpan[]>([]);
  const [txType, setTxType] = useState<UserTxType>("auto");
  const [bank, setBank] = useState("");
  const [bankKnown, setBankKnown] = useState(true);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [fixing, setFixing] = useState<TaggedField | null>(null);
  const [pick, setPick] = useState<{ start: number; end: number } | null>(null);
  const [typeSheet, setTypeSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ read: number; total: number; created: number; outTotal: number; inTotal: number } | null>(null);

  const open = useCallback(async (g: FormatGroup<UnrecognisedSmsRow>, tpls: UserSmsTemplate[]) => {
    const [first, ...rest] = g.messages;
    setGroup(g);
    setSpans(guessSpans(first.body, rest.map((m) => m.body), tpls));
    setTxType("auto");
    setFixing(null);
    setPick(null);
    setDone(null);
    setNameEdited(false);
    const b = await resolveSenderBank(first.address).catch(() => null);
    setBank(b ?? "");
    setBankKnown(b != null);
  }, []);

  useEffect(() => {
    (async () => {
      const [rows, tpls] = await Promise.all([listUnrecognisedSms(2000), listUserTemplates()]);
      const gs = groupByFormat(rows);
      setGroups(gs);
      setTemplates(tpls);
      const g = gs.find((x) => x.key === params.key) ?? gs.find((x) => x.messages.some((m) => m.id === params.smsId)) ?? null;
      if (g) await open(g, tpls);
    })().catch(() => setGroups([]));
  }, [params.key, params.smsId, open]);

  const body = group?.messages[0].body ?? "";
  const direction = useMemo(() => {
    if (txType !== "auto" || !body) return txType;
    return inferDirection(normalizeSms(body).text).type;
  }, [txType, body]);
  const typeLabel = direction === "credit" ? "money in" : direction === "refund" ? "refund" : "money out";

  // A name until the user types their own: "HDFC Bank · money out".
  useEffect(() => {
    if (!nameEdited && group) setName(`${bank || group.sender} · ${typeLabel}`);
  }, [bank, typeLabel, group, nameEdited]);

  const valueOf = (field: TaggedField): string | null => {
    const s = spans.find((x) => x.field === field);
    if (!s) return null;
    const raw = body.slice(s.start, s.end);
    if (field === "amount" || field === "balance") {
      const n = parseFloat(raw.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? formatAmount(n) : raw;
    }
    if (field === "date") {
      const d = parseDateAny(raw.trim().replace(/\s*([-/.:])\s*/g, "$1"));
      return d ? formatDisplayDate(d) : raw;
    }
    if (field === "account") return `${bank ? `${bank} ` : ""}••${raw.replace(/\D/g, "").slice(-4)}`;
    return raw;
  };

  const startFix = (field: TaggedField) => {
    const s = spans.find((x) => x.field === field);
    setFixing(field);
    setPick(s ? { start: s.start, end: s.end } : null);
  };

  const tapWord = (w: { start: number; end: number }) => {
    setPick((p) => {
      // First tap picks a word; the next tap stretches to it. Tapping inside a long pick restarts it.
      if (!p || (w.start >= p.start && w.end <= p.end && (p.end - p.start) > (w.end - w.start))) return { start: w.start, end: w.end };
      return { start: Math.min(p.start, w.start), end: Math.max(p.end, w.end) };
    });
  };

  const finishFix = (remove = false) => {
    if (!fixing) return;
    setSpans((prev) => {
      const others = prev.filter((s) => s.field !== fixing);
      if (remove || !pick) return others;
      const t = trimSpan(body, pick.start, pick.end);
      if (t.end <= t.start) return others;
      // The new pick wins over any guess it overlaps.
      return [...others.filter((s) => s.end <= t.start || s.start >= t.end), { field: fixing, start: t.start, end: t.end }].sort((a, b) => a.start - b.start);
    });
    setFixing(null);
    setPick(null);
  };

  const fullEditor = () => {
    if (!group) return;
    const [first, ...rest] = group.messages;
    startDraft({
      smsBody: first.body,
      spans,
      bankName: bank,
      txType,
      label: name,
      createdFromSmsId: first.id,
      senderPattern: senderCode(first.address),
      senderMatchMode: "code",
      matchStyle: "flexible",
      extraSamples: rest.slice(0, 2).map((m) => ({ body: m.body, spans: guessSpans(m.body, [first.body], templates) })),
    });
    router.push("/settings/sms-templates/tag");
  };

  const save = async () => {
    if (!group) return;
    if (!spans.some((s) => s.field === "amount")) {
      alert("Pick the amount", "Tap Fix next to Amount and tap the number in the message.");
      return;
    }
    if (!bank.trim()) {
      alert("Which bank or wallet?", "Type its name so Arth can link these transactions to the right account.");
      return;
    }
    setSaving(true);
    try {
      const [first, ...rest] = group.messages;
      // More examples make a sturdier template; drop them if they don't fit the guess.
      // Extra examples must carry the same fields in the same order as the first.
      const order = [...spans].sort((x, y) => x.start - y.start).map((x) => x.field);
      let extraSamples = rest
        .slice(0, 2)
        .map((m) => ({
          body: m.body,
          spans: guessSpans(m.body, [first.body], templates).filter((x) => order.includes(x.field)).sort((x, y) => x.start - y.start),
        }))
        .filter((e) => e.spans.map((x) => x.field).join() === order.join());
      const asInput = (ex: typeof extraSamples) => ex.map((e) => ({ smsBody: e.body, spans: e.spans }));
      if (!compileTemplate({ smsBody: first.body, spans, style: "flexible", extraSamples: asInput(extraSamples) }).ok) extraSamples = [];
      const check = compileTemplate({ smsBody: first.body, spans, style: "flexible", extraSamples: asInput(extraSamples) });
      if (!check.ok) {
        setSaving(false);
        alert("Arth couldn't build this one", "Something about the fields doesn't fit. Open the full editor to adjust it.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open editor", onPress: fullEditor },
        ]);
        return;
      }
      const tpl = await createUserTemplate({
        bankName: bank.trim(),
        txType,
        sampleSms: first.body,
        spans,
        label: name.trim() || undefined,
        createdFromSmsId: first.id,
        senderPattern: senderCode(first.address),
        senderMatchMode: "code",
        matchStyle: "flexible",
        extraSamples,
      });
      const under = {
        id: tpl.id,
        patternRegex: tpl.pattern_regex,
        txType: tpl.tx_type,
        bankName: tpl.bank_name,
        senderMatchMode: tpl.sender_match_mode,
        senderPattern: tpl.sender_pattern,
      };
      const { matches } = await findBacklogMatches(under);
      const ids = new Set(group.messages.map((m) => m.id));
      const read = matches.filter((m) => ids.has(m.id)).length;
      let outTotal = 0;
      let inTotal = 0;
      for (const m of matches) {
        if (m.parsed.type === "credit" || m.parsed.type === "upi_credit" || m.parsed.type === "refund") inTotal += m.parsed.amount;
        else outTotal += m.parsed.amount;
      }
      const created = await applyTemplateToBacklog(under);
      setDone({ read, total: group.messages.length, created, outTotal, inTotal });
    } catch (e) {
      alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!groups) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="sparkles-outline" message="Working out the fields…" />
      </ScreenContainer>
    );
  }
  if (!group) {
    return (
      <ScreenContainer padTop={false}>
        <Text className="text-sm text-muted-foreground text-center px-8 mt-10">These messages have already been read.</Text>
      </ScreenContainer>
    );
  }

  const next = groups.find((g) => g.key !== group.key);

  // ── Saved ──
  if (done) {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: group.sender }} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Card>
            <View className="items-center py-2">
              <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: theme.alpha("success", 0.12) }}>
                <Ionicons name="checkmark" size={26} color={theme.success} />
              </View>
              <Text className="text-base font-semibold text-foreground mt-3">Arth can read {group.sender} now</Text>
              <Text className="text-xs text-muted-foreground mt-1">
                {done.read} of {done.total} message{done.total === 1 ? "" : "s"} in this group read correctly
              </Text>
            </View>
          </Card>
          {done.created > 0 && (
            <Card className="mt-3">
              <Text className="text-sm font-medium text-foreground">{done.created} transaction{done.created === 1 ? "" : "s"} to review</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {[done.outTotal > 0 ? `${formatAmount(done.outTotal)} out` : null, done.inTotal > 0 ? `${formatAmount(done.inTotal)} in` : null].filter(Boolean).join(" · ")}
              </Text>
            </Card>
          )}
          <View className="mt-4" style={{ gap: 8 }}>
            {done.created > 0 && <Button title="Review them in Catch Up" onPress={() => router.replace("/expense/catch-up")} />}
            {next ? (
              <Button title={`Teach the next one · ${next.sender}`} variant="outline" onPress={() => void open(next, templates)} />
            ) : (
              <Button title="Done" variant="outline" onPress={() => router.back()} />
            )}
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Fixing one field: tap the right words ──
  if (fixing) {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: `Which part is the ${FIELD_META[fixing].label.toLowerCase()}?` }} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Card>
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {words(body).map((w) => {
                const on = pick != null && w.start >= pick.start && w.end <= pick.end;
                return (
                  <Pressable
                    key={w.start}
                    onPress={() => tapWord(w)}
                    className="rounded-md px-1.5 py-1"
                    style={{
                      backgroundColor: on ? FIELD_META[fixing].color + "33" : "transparent",
                      borderWidth: 1,
                      borderColor: on ? FIELD_META[fixing].color : theme.border,
                      borderStyle: on ? "solid" : "dashed",
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text className="text-sm text-foreground">{w.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
          <Text className="text-xs text-muted-foreground mt-2 px-1">
            Tap a word, then tap another to take the words between. Only this field changes; the rest stays as guessed.
          </Text>
          <Card className="mt-3">
            <View className="flex-row items-center">
              <View className="w-2.5 h-2.5 rounded-sm mr-2" style={{ backgroundColor: FIELD_META[fixing].color }} />
              <Text className="text-sm text-muted-foreground">{FIELD_META[fixing].label}</Text>
              <Text className="text-sm font-semibold text-foreground ml-2 flex-1" numberOfLines={1}>
                {pick ? body.slice(trimSpan(body, pick.start, pick.end).start, trimSpan(body, pick.start, pick.end).end) : "Nothing picked"}
              </Text>
            </View>
          </Card>
          <View className="mt-4" style={{ gap: 8 }}>
            <Button title="Done" onPress={() => finishFix(false)} />
            {fixing !== "amount" && <Button title={`Not in this message`} variant="ghost" onPress={() => finishFix(true)} />}
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── The guess ──
  const shown = [...new Set<TaggedField>([...CORE_FIELDS, ...spans.map((s) => s.field)])];
  const highlighted = (() => {
    const parts: { text: string; field?: TaggedField }[] = [];
    let at = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.start > at) parts.push({ text: body.slice(at, s.start) });
      parts.push({ text: body.slice(s.start, s.end), field: s.field });
      at = s.end;
    }
    if (at < body.length) parts.push({ text: body.slice(at) });
    return parts;
  })();

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: group.sender }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card>
          <View className="rounded-xl px-3 py-2.5" style={{ backgroundColor: theme.alpha("foreground", 0.04), borderTopLeftRadius: 4 }}>
            <Text className="text-sm text-foreground leading-6">
              {highlighted.map((p, i) =>
                p.field ? (
                  <Text key={i} className="text-sm font-semibold" style={{ color: FIELD_META[p.field].color, backgroundColor: FIELD_META[p.field].color + "22" }}>
                    {p.text}
                  </Text>
                ) : (
                  <Text key={i}>{p.text}</Text>
                ),
              )}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground mt-2">
            {group.messages.length > 1 ? `Compared with ${group.messages.length - 1} other message${group.messages.length === 2 ? "" : "s"} from ${group.sender}` : `From ${group.sender}`}
          </Text>
        </Card>

        <Card className="mt-3">
          {shown.map((f, i) => {
            const v = valueOf(f);
            return (
              <Pressable
                key={f}
                onPress={() => startFix(f)}
                className="flex-row items-center py-2.5"
                style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined}
                accessibilityRole="button"
                accessibilityLabel={`${FIELD_META[f].label}: ${v ?? "not found"}. Fix`}
              >
                <View className="w-2.5 h-2.5 rounded-sm mr-2" style={{ backgroundColor: FIELD_META[f].color, opacity: v ? 1 : 0.35 }} />
                <Text className="text-sm text-muted-foreground" style={{ width: 96 }}>{FIELD_META[f].label}</Text>
                <Text className={`text-sm flex-1 ${v ? "font-semibold text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
                  {v ?? "Not found"}
                </Text>
                <Text className="text-xs font-medium" style={{ color: theme.primary }}>{v ? "Fix" : "Add"}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setTypeSheet(true)}
            className="flex-row items-center py-2.5"
            style={{ borderTopWidth: 1, borderTopColor: theme.border }}
            accessibilityRole="button"
          >
            <Ionicons
              name={direction === "credit" ? "arrow-down-outline" : direction === "refund" ? "return-down-back-outline" : "arrow-up-outline"}
              size={14}
              color={direction === "debit" ? theme.danger : theme.success}
              style={{ marginRight: 6 }}
            />
            <Text className="text-sm text-foreground flex-1">
              {direction === "credit" ? "Money in" : direction === "refund" ? "Refund" : "Money out"}
              {txType === "auto" ? <Text className="text-xs text-muted-foreground"> · from the words</Text> : null}
            </Text>
            <Text className="text-xs font-medium" style={{ color: theme.primary }}>Change</Text>
          </Pressable>
        </Card>

        <Card className="mt-3">
          <Text className="text-xs text-muted-foreground">Bank or wallet</Text>
          {bankKnown ? (
            <Pressable onPress={() => setBankKnown(false)} className="flex-row items-center mt-0.5" accessibilityRole="button">
              <Text className="text-sm font-medium text-foreground flex-1">{bank}</Text>
              <Text className="text-xs text-muted-foreground">from the sender · </Text>
              <Text className="text-xs font-medium" style={{ color: theme.primary }}>Change</Text>
            </Pressable>
          ) : (
            <TextInput
              value={bank}
              onChangeText={setBank}
              placeholder="Kotak Bank, Amazon Pay"
              placeholderTextColor={theme.mutedForeground}
              className="text-sm text-foreground py-1.5 border-b"
              style={{ borderColor: theme.primary }}
              accessibilityLabel="Bank or wallet"
            />
          )}
          <Text className="text-xs text-muted-foreground mt-3">Template name</Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setNameEdited(true);
            }}
            className="text-sm text-foreground py-1.5 border-b border-border"
            accessibilityLabel="Template name"
          />
        </Card>

        <View className="flex-row mt-4" style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Something's off" variant="outline" onPress={fullEditor} />
          </View>
          <View style={{ flex: 1.4 }}>
            {saving ? (
              <View className="items-center justify-center py-3"><ActivityIndicator color={theme.primary} /></View>
            ) : (
              <Button title="Looks right" onPress={() => void save()} />
            )}
          </View>
        </View>
      </ScrollView>

      <SelectSheet
        visible={typeSheet}
        title="This message is"
        options={TYPE_OPTIONS}
        value={txType}
        onChange={(v) => setTxType(v as UserTxType)}
        onClose={() => setTypeSheet(false)}
      />
    </ScreenContainer>
  );
}
