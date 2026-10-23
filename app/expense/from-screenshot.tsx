import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { useTheme } from "@/hooks/use-theme";
import { isTextReaderAvailable, readTextInImage, type TextLine } from "../../modules/arth-text-reader";
import { readReceipt, type ReceiptGuess, type ReceiptKind } from "@/services/receipt/read-receipt";
import {
  findPossibleDuplicate,
  findPossibleDuplicateTransfer,
  getOwnAccounts,
  matchAccount,
  type OwnAccount,
  type PossibleDuplicate,
} from "@/services/receipt/receipt-to-transaction";
import {
  applyTemplate,
  buildTemplate,
  extractField,
  listImageTemplates,
  markImageTemplateUsed,
  matchTemplate,
  picturePieces,
  saveImageTemplate,
  TEMPLATE_FIELDS,
  withTemplate,
  type ImageTemplate,
  type TemplateField,
} from "@/services/receipt/image-templates";
import { addUpiId } from "@/services/account-upi";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

const KINDS: { kind: ReceiptKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: "expense", label: "Expense", icon: "arrow-up-outline" },
  { kind: "credit", label: "Money in", icon: "arrow-down-outline" },
  { kind: "transfer", label: "Transfer", icon: "swap-horizontal" },
  { kind: "committed", label: "EMI / SIP", icon: "repeat-outline" },
];

type Phase = "pick" | "reading" | "read" | "failed";

/** The piece of text a field's value came from, so teaching starts from what was already found. */
function findPicks(pieces: TextLine[], g: ReceiptGuess): Partial<Record<TemplateField, number>> {
  const picks: Partial<Record<TemplateField, number>> = {};
  const want: Partial<Record<TemplateField, unknown>> = {
    amount: g.amount,
    party: g.party,
    date: g.date,
    ref: g.ref,
    vpa: g.vpa,
    ownVpa: g.ownVpa,
    note: g.note,
  };
  const used = new Set<number>();
  for (const [field, value] of Object.entries(want) as [TemplateField, unknown][]) {
    if (value == null) continue;
    const i = pieces.findIndex((p, idx) => !used.has(idx) && extractField(field, p.text)?.value === value);
    if (i >= 0) {
      picks[field] = i;
      used.add(i);
    }
  }
  if (g.account?.last4) {
    const i = pieces.findIndex((p, idx) => !used.has(idx) && p.text.includes(g.account!.last4!));
    if (i >= 0) picks.account = i;
  }
  return picks;
}

/**
 * Add a transaction from a payment picture: a screenshot from the gallery, one shared to Arth, or a
 * photo of a receipt. It's read on the phone (modules/arth-text-reader), the receipt reader works out
 * what it is (services/receipt/read-receipt.ts) - or a template the user taught for that layout
 * (services/receipt/image-templates.ts) - and this screen shows what was found to confirm: the kind,
 * amount, who, when, the account (by its linked UPI ID first), and whether it looks already recorded.
 * Anything missed can be taught by tapping it on the picture. Continue opens the Add screen filled
 * in; nothing is saved until it's saved there.
 */
export default function FromScreenshotScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const stackOptions = useStackScreenOptions();
  const params = useLocalSearchParams<{ uri?: string; text?: string }>();
  const [uri, setUri] = useState<string | null>(params.uri ?? null);
  const [phase, setPhase] = useState<Phase>(params.uri || params.text ? "reading" : "pick");
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState<ReceiptGuess | null>(null);
  const [kind, setKind] = useState<ReceiptKind>("expense");
  const [accounts, setAccounts] = useState<OwnAccount[]>([]);
  const [duplicate, setDuplicate] = useState<PossibleDuplicate | null>(null);
  const [duplicateTransfer, setDuplicateTransfer] = useState(false);
  const [showRead, setShowRead] = useState(false);

  // The picture's text with positions (null for shared text), and its proportions.
  const [pieces, setPieces] = useState<TextLine[] | null>(null);
  const [aspect, setAspect] = useState(2);
  const [template, setTemplate] = useState<ImageTemplate | null>(null);

  // Accounts picked by hand, and whether to remember the UPI IDs for them.
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<"from" | "to" | null>(null);
  const [rememberUpi, setRememberUpi] = useState(true);

  // Teaching a template: which piece is which field.
  const [teaching, setTeaching] = useState(false);
  const [picks, setPicks] = useState<Partial<Record<TemplateField, number>>>({});
  const [tapped, setTapped] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [width, setWidth] = useState(0);
  const [saving, setSaving] = useState(false);

  const read = useCallback(async (source: { uri?: string; text?: string }) => {
    setPhase("reading");
    setError(null);
    setShowRead(false);
    setTeaching(false);
    setFromId(null);
    setToId(null);
    setTemplate(null);
    try {
      const [result, own, templates] = await Promise.all([
        source.uri ? readTextInImage(source.uri) : Promise.resolve(null),
        getOwnAccounts(),
        listImageTemplates().catch(() => [] as ImageTemplate[]),
      ]);
      let g: ReceiptGuess;
      if (result) {
        const p = picturePieces(result.lines);
        setPieces(p);
        setAspect(result.imageHeight / Math.max(1, result.imageWidth));
        g = readReceipt(result.lines);
        const t = matchTemplate(p, templates);
        if (t) {
          g = withTemplate(g, t.kind, applyTemplate(p, t.fields));
          setTemplate(t);
          void markImageTemplateUsed(t.id).catch(() => {});
        }
      } else {
        setPieces(null);
        g = readReceipt(source.text!.split(/\r?\n/));
      }
      setAccounts(own);
      setGuess(g);
      setKind(g.kind);
      setPhase("read");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    if (params.uri) void read({ uri: params.uri });
    else if (params.text) void read({ text: params.text });
  }, [params.uri, params.text, read]);

  const pick = useCallback(
    async (source: "gallery" | "camera") => {
      try {
        let res: ImagePicker.ImagePickerResult;
        if (source === "camera") {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            toast("Arth needs the camera to take a photo. You can allow it in the phone's settings.");
            return;
          }
          res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
        } else {
          res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
        }
        if (res.canceled || !res.assets?.[0]) return;
        setUri(res.assets[0].uri);
        void read({ uri: res.assets[0].uri });
      } catch (e) {
        toast(e instanceof Error ? e.message : "Couldn't open that");
      }
    },
    [read, toast],
  );

  const auto = useMemo(() => {
    if (!guess) return { from: null as OwnAccount | null, to: null as OwnAccount | null };
    if (kind === "transfer") {
      return {
        from: matchAccount(guess.account, accounts, guess.app, guess.ownVpa),
        to: matchAccount(guess.toAccount, accounts, guess.app, guess.vpa),
      };
    }
    return { from: matchAccount(guess.account, accounts, guess.app, guess.ownVpa), to: null };
  }, [guess, accounts, kind]);
  const from = (fromId ? accounts.find((a) => a.id === fromId) : null) ?? auto.from;
  const to = kind === "transfer" ? ((toId ? accounts.find((a) => a.id === toId) : null) ?? auto.to) : null;
  const matchedByUpi = !fromId && !!from && !!guess?.ownVpa && from.upi_ids.includes(guess.ownVpa);

  // UPI IDs on the picture that aren't linked to the chosen account yet.
  const unlinked = useMemo(() => {
    const out: { account: OwnAccount; id: string }[] = [];
    if (guess?.ownVpa && from && !from.upi_ids.includes(guess.ownVpa)) out.push({ account: from, id: guess.ownVpa });
    if (kind === "transfer" && guess?.vpa && to && !to.upi_ids.includes(guess.vpa)) out.push({ account: to, id: guess.vpa });
    return out;
  }, [guess, from, to, kind]);

  // Already in Arth? (The bank's message often got there first.)
  useEffect(() => {
    if (!guess || phase !== "read") return;
    setDuplicate(null);
    setDuplicateTransfer(false);
    if (kind === "transfer") {
      if (guess.amount && guess.date && from && to) {
        findPossibleDuplicateTransfer(guess.amount, guess.date, from.id, to.id).then(setDuplicateTransfer).catch(() => {});
      }
    } else {
      findPossibleDuplicate({ ...guess, kind }, from?.id ?? null).then(setDuplicate).catch(() => {});
    }
  }, [guess, kind, from, to, phase]);

  const accountName = (a: OwnAccount) => `${a.account_label || a.bank_name}${a.account_identifier && a.account_type !== "wallet" ? ` ··${a.account_identifier.slice(-4)}` : ""}`;

  const proceed = async () => {
    if (!guess) return;
    if (rememberUpi && unlinked.length) {
      for (const u of unlinked) await addUpiId(u.account.id, u.id).catch(() => {});
    }
    const description = [guess.note, guess.app, guess.ref ? `ref ${guess.ref}` : null].filter(Boolean).join(" · ");
    const base: Record<string, string> = {};
    if (guess.amount) base.prefillAmount = String(guess.amount);
    if (guess.date) base.prefillDate = guess.date;
    if (from) base.prefillAccountId = from.id;
    if (description) base.prefillDescription = description;
    if (kind === "transfer") {
      router.replace({ pathname: "/expense/add", params: { ...base, type: "transfer", ...(to ? { prefillToAccountId: to.id } : {}) } });
      return;
    }
    if (guess.party) base.prefillMerchant = guess.party;
    router.replace({
      pathname: "/expense/add",
      params: {
        ...base,
        ...(kind === "credit" ? { type: "credit" } : {}),
        // An EMI or SIP: after saving, the transaction opens so it can be linked to its loan or investment.
        ...(kind === "committed" ? { afterSave: "detail" } : {}),
      },
    });
  };

  const startTeaching = () => {
    if (!pieces || !guess) return;
    setPicks(findPicks(pieces, guess));
    setTapped(null);
    setTemplateName(template?.name ?? guess.app ?? "");
    setTeaching(true);
  };

  const assign = (field: TemplateField | null) => {
    if (tapped == null) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const f of Object.keys(next) as TemplateField[]) if (next[f] === tapped) delete next[f];
      if (field) next[field] = tapped;
      return next;
    });
    setTapped(null);
  };

  const saveTemplate = async () => {
    if (!pieces || !guess) return;
    if (Object.keys(picks).length === 0) {
      toast("Tap at least one value on the picture first");
      return;
    }
    setSaving(true);
    try {
      const learned = buildTemplate(pieces, picks);
      const id = await saveImageTemplate({
        id: template?.id,
        name: templateName || guess.app || "Picture template",
        kind,
        anchors: learned.anchors,
        fields: learned.fields,
        sampleText: guess.text,
      });
      const g = withTemplate(guess, kind, applyTemplate(pieces, learned.fields));
      setGuess(g);
      setTemplate({ id, name: templateName || guess.app || "Picture template", kind, anchors: learned.anchors, fields: learned.fields, sampleText: guess.text, useCount: 0, updatedAt: "" });
      setTeaching(false);
      toast("Saved. Pictures like this will be read this way.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the template");
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, value, muted, onPress }: { label: string; value: string; muted?: boolean; onPress?: () => void }) => (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row items-center py-2.5 border-b border-border" accessibilityRole={onPress ? "button" : undefined}>
      <Text className="text-sm text-muted-foreground" style={{ width: 92 }}>{label}</Text>
      <Text className="text-sm flex-1 text-right" style={{ color: muted ? theme.mutedForeground : theme.foreground }}>
        {value}
      </Text>
      {onPress && <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} style={{ marginLeft: 6 }} />}
    </Pressable>
  );

  const AccountChoices = ({ side }: { side: "from" | "to" }) => (
    <View className="flex-row flex-wrap py-2" style={{ gap: 6 }}>
      {accounts.map((a) => {
        const on = (side === "from" ? from : to)?.id === a.id;
        return (
          <Pressable
            key={a.id}
            onPress={() => {
              if (side === "from") setFromId(a.id);
              else setToId(a.id);
              setChoosing(null);
            }}
            className="rounded-full px-3 py-1.5"
            style={{ borderWidth: 1, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text className="text-xs font-medium" style={{ color: on ? theme.primary : theme.foreground }}>{accountName(a)}</Text>
          </Pressable>
        );
      })}
      {accounts.length === 0 && <Text className="text-xs text-muted-foreground">No accounts yet - pick one on the next screen.</Text>}
    </View>
  );

  const unmatchedText = (h: ReceiptGuess["account"]) =>
    h ? `${h.label}${h.last4 ? ` ··${h.last4}` : ""} · tap to choose` : "Tap to choose";

  const fieldLabel = (f: TemplateField) => {
    const d = TEMPLATE_FIELDS.find((x) => x.field === f)!;
    return kind === "credit" && d.creditLabel ? d.creditLabel : d.label;
  };
  const pickedField = (i: number) => (Object.keys(picks) as TemplateField[]).find((f) => picks[f] === i) ?? null;

  // ─── Teaching: the picture with every piece of text tappable ───
  if (teaching && pieces && uri) {
    const height = width * aspect;
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ ...stackOptions, headerShown: true, title: "Teach this layout" }} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            Tap a value on the picture, then say what it is. Arth remembers this layout and reads the next picture like it the same way.
          </Text>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%" }}>
            {width > 0 && (
              <View style={{ width, height }}>
                <Image source={{ uri }} style={{ width, height, borderRadius: 8 }} resizeMode="stretch" />
                {pieces.map((p, i) => {
                  const f = pickedField(i);
                  const on = tapped === i;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => setTapped(i)}
                      style={{
                        position: "absolute",
                        left: p.x * width - 3,
                        top: p.y * height - 3,
                        width: p.width * width + 6,
                        height: Math.max(p.height * height + 6, 22),
                        borderRadius: 4,
                        borderWidth: on ? 2 : 1.5,
                        borderColor: on ? theme.warning : f ? theme.primary : theme.alpha("primary", 0.35),
                        backgroundColor: f ? theme.alpha("primary", 0.18) : on ? theme.alpha("warning", 0.15) : undefined,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.text}${f ? `, ${fieldLabel(f)}` : ""}`}
                    >
                      {f && (
                        <View style={{ position: "absolute", top: -16, left: 0, backgroundColor: theme.primary, borderRadius: 3, paddingHorizontal: 4 }}>
                          <Text style={{ color: theme.primaryForeground, fontSize: 10, fontWeight: "700" }}>{fieldLabel(f)}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <Card className="mt-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">What it found</Text>
            {(Object.keys(picks) as TemplateField[]).length === 0 && <Text className="text-sm text-muted-foreground">Nothing yet - tap a value on the picture.</Text>}
            {TEMPLATE_FIELDS.filter((d) => picks[d.field] != null).map((d) => (
              <View key={d.field} className="flex-row py-1.5">
                <Text className="text-sm text-muted-foreground" style={{ width: 130 }}>{fieldLabel(d.field)}</Text>
                <Text className="text-sm text-foreground flex-1" numberOfLines={1}>{pieces[picks[d.field]!]?.text}</Text>
              </View>
            ))}
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-1">Name</Text>
            <TextInput
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="e.g. ICICI Bank payment"
              placeholderTextColor={theme.mutedForeground}
              className="text-sm text-foreground rounded-lg px-3 py-2 border border-border"
              accessibilityLabel="Template name"
            />
            <Button title={template ? "Update template" : "Save template"} onPress={() => void saveTemplate()} loading={saving} className="mt-4" />
            <Button title="Cancel" variant="ghost" onPress={() => setTeaching(false)} className="mt-1" />
          </Card>
        </ScrollView>

        {tapped != null && (
          <View
            className="absolute left-0 right-0 bottom-0 px-4 pt-3 pb-6 border-t border-border"
            style={{ backgroundColor: theme.card }}
          >
            <Text className="text-xs text-muted-foreground">What is this?</Text>
            <Text className="text-sm font-semibold text-foreground mt-0.5" numberOfLines={2}>{pieces[tapped]?.text}</Text>
            <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
              {TEMPLATE_FIELDS.map((d) => {
                const on = picks[d.field] === tapped;
                const ok = extractField(d.field, pieces[tapped]?.text ?? "") != null;
                return (
                  <Pressable
                    key={d.field}
                    onPress={() => ok && assign(d.field)}
                    disabled={!ok}
                    className="rounded-full px-3 py-1.5"
                    style={{ borderWidth: 1, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined, opacity: ok ? 1 : 0.35 }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !ok, selected: on }}
                  >
                    <Text className="text-xs font-medium" style={{ color: on ? theme.primary : theme.foreground }}>{fieldLabel(d.field)}</Text>
                  </Pressable>
                );
              })}
              {pickedField(tapped) && (
                <Pressable onPress={() => assign(null)} className="rounded-full px-3 py-1.5" style={{ borderWidth: 1, borderColor: theme.border }} accessibilityRole="button">
                  <Text className="text-xs font-medium text-muted-foreground">Not this</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setTapped(null)} className="rounded-full px-3 py-1.5" accessibilityRole="button">
                <Text className="text-xs font-medium text-muted-foreground">Close</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ ...stackOptions, headerShown: true, title: "Add from a picture" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!isTextReaderAvailable && (
          <Card className="mb-3">
            <Text className="text-sm text-foreground">Reading pictures needs the full app build; it isn't available here.</Text>
          </Card>
        )}

        {phase === "pick" && (
          <View className="items-center py-8">
            <Ionicons name="image-outline" size={48} color={theme.primary} />
            <Text className="text-lg font-semibold text-foreground mt-3">Add from a payment picture</Text>
            <Text className="text-sm text-muted-foreground text-center mt-1 leading-5 px-4">
              A payment's success screen from Google Pay, PhonePe, Paytm, Amazon Pay, BHIM, CRED or a bank app, or a photo of a
              receipt. It's read on this phone. Tip: share a screenshot straight to Arth to skip this step.
            </Text>
            <Button title="Choose from gallery" onPress={() => void pick("gallery")} className="mt-5 self-stretch mx-6" />
            <Button title="Take a photo" variant="outline" onPress={() => void pick("camera")} className="mt-2 self-stretch mx-6" />
          </View>
        )}

        {uri && phase !== "pick" && (
          <Image source={{ uri }} style={{ width: "100%", height: 220, borderRadius: 12, backgroundColor: theme.alpha("foreground", 0.05) }} resizeMode="contain" />
        )}

        {phase === "reading" && (
          <View className="items-center py-8">
            <ActivityIndicator color={theme.primary} />
            <Text className="text-sm text-muted-foreground mt-3">Reading the picture…</Text>
          </View>
        )}

        {phase === "failed" && (
          <Card className="mt-3">
            <Text className="text-base font-semibold text-foreground">Couldn't read that image</Text>
            <Text className="text-sm text-muted-foreground mt-1">{error}</Text>
            <Button title="Choose another" variant="outline" onPress={() => void pick("gallery")} className="mt-3" />
            <Button title="Add by hand" variant="ghost" onPress={() => router.replace("/expense/add")} className="mt-1" />
          </Card>
        )}

        {phase === "read" && guess && (
          <>
            {guess.notCompleted && (
              <View className="mt-3 p-3 rounded-xl" style={{ backgroundColor: theme.alpha("warning", 0.12) }}>
                <Text className="text-sm font-semibold" style={{ color: theme.warning }}>This payment looks failed or pending</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">Add it only if the money actually moved.</Text>
              </View>
            )}

            {template && (
              <View className="flex-row items-center mt-3">
                <Ionicons name="sparkles-outline" size={14} color={theme.primary} />
                <Text className="text-xs ml-1.5" style={{ color: theme.primary }}>Read with your template "{template.name}"</Text>
              </View>
            )}

            {/* What kind of transaction */}
            <View className="flex-row flex-wrap mt-4" style={{ gap: 8 }}>
              {KINDS.map((k) => {
                const on = kind === k.kind;
                return (
                  <Pressable
                    key={k.kind}
                    onPress={() => setKind(k.kind)}
                    className="flex-row items-center rounded-full px-4"
                    style={{ height: 40, borderWidth: 1.5, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : undefined }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Ionicons name={k.icon} size={16} color={on ? theme.primary : theme.mutedForeground} />
                    <Text className="text-sm font-semibold ml-1.5" style={{ color: on ? theme.primary : theme.foreground }}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Card className="mt-3">
              <Text style={{ fontSize: 34, fontWeight: "800", color: guess.amount ? theme.foreground : theme.mutedForeground }}>
                {guess.amount ? formatAmount(guess.amount) : "Amount not found"}
              </Text>
              {kind === "transfer" ? (
                <>
                  <Field label="From" value={from ? accountName(from) : unmatchedText(guess.account)} muted={!from} onPress={() => setChoosing(choosing === "from" ? null : "from")} />
                  {choosing === "from" && <AccountChoices side="from" />}
                  <Field label="To" value={to ? accountName(to) : unmatchedText(guess.toAccount)} muted={!to} onPress={() => setChoosing(choosing === "to" ? null : "to")} />
                  {choosing === "to" && <AccountChoices side="to" />}
                </>
              ) : (
                <>
                  <Field label={kind === "credit" ? "From" : "Paid to"} value={guess.party ?? "Not found"} muted={!guess.party} />
                  {guess.vpa && <Field label="UPI ID" value={guess.vpa} />}
                  <Field
                    label={kind === "credit" ? "Into" : "Paid from"}
                    value={from ? `${accountName(from)}${matchedByUpi ? " · by UPI ID" : ""}` : unmatchedText(guess.account)}
                    muted={!from}
                    onPress={() => setChoosing(choosing === "from" ? null : "from")}
                  />
                  {choosing === "from" && <AccountChoices side="from" />}
                </>
              )}
              {guess.ownVpa && kind !== "transfer" && <Field label="Your UPI ID" value={guess.ownVpa} />}
              <Field label="When" value={guess.date ? `${formatDisplayDate(guess.date)}${guess.time ? `, ${guess.time}` : ""}` : "Not found"} muted={!guess.date} />
              {guess.note && <Field label="Note" value={guess.note} />}
              {guess.ref && <Field label="Reference" value={guess.ref} />}
              {guess.app && <Field label="From app" value={guess.app} />}

              {unlinked.length > 0 && (
                <Pressable onPress={() => setRememberUpi((v) => !v)} className="flex-row items-start pt-3" accessibilityRole="checkbox" accessibilityState={{ checked: rememberUpi }}>
                  <Ionicons name={rememberUpi ? "checkbox" : "square-outline"} size={20} color={rememberUpi ? theme.primary : theme.faintForeground} />
                  <Text className="text-sm text-foreground ml-2 flex-1 leading-5">
                    {unlinked.map((u) => `Remember ${u.id} for ${accountName(u.account)}`).join("; ")}
                    <Text className="text-xs text-muted-foreground">{"\n"}The next picture with this UPI ID picks the account by itself.</Text>
                  </Text>
                </Pressable>
              )}
            </Card>

            {(duplicate || duplicateTransfer) && (
              <View className="mt-3 p-3 rounded-xl" style={{ backgroundColor: theme.alpha("warning", 0.12) }}>
                <Text className="text-sm font-semibold" style={{ color: theme.warning }}>Looks already recorded</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {duplicate
                    ? `${duplicate.merchant ?? "A transaction"} · ${formatAmount(duplicate.amount)} · ${formatDisplayDate(duplicate.date)}, probably from the bank's message.`
                    : "A transfer between these accounts for this amount is already there."}
                </Text>
                {duplicate && (
                  <Button title="Open it" variant="outline" onPress={() => router.replace({ pathname: "/expense/[id]", params: { id: duplicate.id } })} className="mt-2" />
                )}
              </View>
            )}

            {kind === "committed" && (
              <Text className="text-xs text-muted-foreground mt-3 px-1">
                Saved as an expense; then link it to its loan or investment from the transaction, and it counts as an EMI or investment.
              </Text>
            )}

            <Button title={duplicate || duplicateTransfer ? "Add anyway" : "Continue"} onPress={() => void proceed()} className="mt-4" />
            <Text className="text-xs text-muted-foreground text-center mt-2">You can change anything on the next screen before saving.</Text>

            {pieces && uri && (
              <Pressable onPress={startTeaching} className="mt-4 p-3 rounded-xl flex-row items-center" style={{ backgroundColor: theme.alpha("primary", 0.08) }} accessibilityRole="button">
                <Ionicons name="hand-left-outline" size={18} color={theme.primary} />
                <View className="ml-2.5 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.primary }}>{template ? "Fix the template" : "Something missing or wrong?"}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">Tap the values on the picture and Arth learns this layout.</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.primary} />
              </Pressable>
            )}

            <Pressable onPress={() => setShowRead((v) => !v)} className="mt-3 py-2" accessibilityRole="button">
              <Text className="text-sm font-medium text-center" style={{ color: theme.primary }}>
                {showRead ? "Hide what was read" : "Show what was read"}
              </Text>
            </Pressable>
            {showRead && (
              <Card>
                <Text className="text-xs text-muted-foreground" selectable style={{ fontFamily: "monospace" }}>
                  {guess.text || "(no text found)"}
                </Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
