import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { useTheme } from "@/hooks/use-theme";
import { isTextReaderAvailable, readTextInImage, type TextLine } from "../../modules/arth-text-reader";
import { accountFrom, money, parseDate, parseTime, readReceipt, type ReceiptGuess, type ReceiptKind } from "@/services/receipt/read-receipt";
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
  pickBox,
  pickText,
  TEMPLATE_FIELDS,
  valuesFromPicks,
  withTemplate,
  wordsOf,
  type ImageTemplate,
  type TemplateField,
  type TemplateValues,
  type TextPick,
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

/** The text a field's value came from (a piece, or a word of it), so linking starts from what was found. */
function findPicks(pieces: TextLine[], g: ReceiptGuess): Partial<Record<TemplateField, TextPick>> {
  const picks: Partial<Record<TemplateField, TextPick>> = {};
  const want: Partial<Record<TemplateField, unknown>> = {
    amount: g.amount,
    party: g.party,
    date: g.date,
    ref: g.ref,
    vpa: g.vpa,
    ownVpa: g.ownVpa,
    note: g.note,
  };
  const used = new Set<string>();
  for (const [field, value] of Object.entries(want) as [TemplateField, unknown][]) {
    if (value == null) continue;
    const i = pieces.findIndex((p, idx) => !used.has(`${idx}`) && extractField(field, p.text)?.value === value);
    if (i >= 0) {
      picks[field] = { i };
      used.add(`${i}`);
      continue;
    }
    for (let idx = 0; idx < pieces.length && !picks[field]; idx++) {
      if (used.has(`${idx}`)) continue;
      const words = wordsOf(pieces[idx]);
      if (words.length < 2) continue;
      const j = words.findIndex((w, k) => !used.has(`${idx}:${k}`) && extractField(field, w.text)?.value === value);
      if (j >= 0) {
        picks[field] = { i: idx, from: j, to: j };
        used.add(`${idx}:${j}`);
      }
    }
  }
  if (g.account?.last4) {
    const i = pieces.findIndex((p, idx) => !used.has(`${idx}`) && p.text.includes(g.account!.last4!));
    if (i >= 0) picks.account = { i };
  }
  return picks;
}

/** Word span of a pick on a piece of n words (the whole piece when none). */
const spanOf = (pk: TextPick, n: number): [number, number] => (pk.from == null || pk.to == null ? [0, n - 1] : [pk.from, pk.to]);

/** A value the user typed over what was read: parsed into what the field holds. */
function parseEdit(field: TemplateField, text: string): Partial<TemplateValues> {
  const t = text.trim();
  if (!t) return {};
  switch (field) {
    case "amount": {
      const v = money(t.replace(/[^\d.,]/g, ""));
      return v ? { amount: v } : {};
    }
    case "date": {
      const d = parseDate(t);
      return d ? { date: d, time: parseTime(t) } : {};
    }
    case "account":
      return { account: accountFrom(t) ?? { label: t.slice(0, 40), last4: t.match(/(\d{3,4})\D*$/)?.[1] ?? null, wallet: false } };
    case "vpa":
    case "ownVpa":
      return { [field]: t.toLowerCase() };
    default:
      return { [field]: t };
  }
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
  // teach=1: from Settings > Picture templates - pick a picture, then go straight to linking its text;
  // with templateId, that template is re-taught (updated) rather than a new one saved.
  const params = useLocalSearchParams<{ uri?: string; text?: string; teach?: string; templateId?: string }>();
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
  const [picks, setPicks] = useState<Partial<Record<TemplateField, TextPick>>>({});
  const [tapped, setTapped] = useState<number | null>(null);
  // Words chosen on the tapped piece (inclusive); null = the whole piece.
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  // Values typed over what was read, for this transaction only (the template keeps the links).
  const [edits, setEdits] = useState<Partial<Record<TemplateField, string>>>({});
  const [templateName, setTemplateName] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);
  const [width, setWidth] = useState(0);
  const [saving, setSaving] = useState(false);

  const teachFirst = params.teach === "1" || !!params.templateId;
  const reteachId = params.templateId ?? null;
  const read = useCallback(async (source: { uri?: string; text?: string }) => {
    setPhase("reading");
    setError(null);
    setShowRead(false);
    setTeaching(false);
    setFromId(null);
    setToId(null);
    setTemplate(null);
    let result: Awaited<ReturnType<typeof readTextInImage>> | null = null;
    try {
      result = source.uri ? await readTextInImage(source.uri) : null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
      return;
    }
    // After the picture is read, not alongside it: on a Pixel 9 the account lookup failed
    // ("NativeDatabase.prepareAsync ... NullPointerException") while the text reader was running.
    // The accounts and templates only improve the result: if they can't be loaded, the picture is
    // still shown as read (the account is then picked on the Add screen).
    const own = await getOwnAccounts().catch(() => [] as OwnAccount[]);
    const templates = await listImageTemplates().catch(() => [] as ImageTemplate[]);
    let g: ReceiptGuess;
    let p: TextLine[] | null = null;
    if (result) {
      p = picturePieces(result.lines);
      setPieces(p);
      setAspect(result.imageHeight / Math.max(1, result.imageWidth));
      g = readReceipt(result.lines);
      const t = reteachId ? (templates.find((x) => x.id === reteachId) ?? null) : matchTemplate(p, templates);
      if (t) {
        g = withTemplate(g, t.kind, applyTemplate(p, t.fields));
        setTemplate(t);
        if (!reteachId) void markImageTemplateUsed(t.id).catch(() => {});
      }
    } else {
      setPieces(null);
      g = readReceipt(source.text!.split(/\r?\n/));
    }
    setAccounts(own);
    setGuess(g);
    setKind(g.kind);
    setPhase("read");
    if (teachFirst && p && p.length) {
      setPicks(findPicks(p, g));
      setTapped(null);
      setEdits({});
      setTemplateName((reteachId ? templates.find((x) => x.id === reteachId)?.name : null) ?? g.app ?? "");
      setSaveAsTemplate(true);
      setTeaching(true);
    }
  }, [teachFirst, reteachId]);

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
    setEdits({});
    setTemplateName(template?.name ?? guess.app ?? "");
    setSaveAsTemplate(true);
    setTeaching(true);
  };

  /** Open a piece: its words start as already linked, else the whole piece. */
  const openPiece = (i: number) => {
    const linked = (Object.values(picks) as TextPick[]).find((pk) => pk.i === i && pk.from != null);
    setTapped(i);
    setSel(linked && linked.from != null && linked.to != null ? { from: linked.from, to: linked.to } : null);
  };

  /** A word chip: one word, then a second makes the range between; tapping the one word again, the whole piece. */
  const tapWord = (j: number) =>
    setSel((prev) => {
      if (!prev) return { from: j, to: j };
      if (prev.from === prev.to) {
        if (prev.from === j) return null;
        return { from: Math.min(prev.from, j), to: Math.max(prev.from, j) };
      }
      return { from: j, to: j };
    });

  const selectedText = () => {
    if (tapped == null || !pieces) return "";
    return pickText(pieces, sel ? { i: tapped, ...sel } : { i: tapped }) ?? "";
  };

  const assign = (field: TemplateField | null) => {
    if (tapped == null || !pieces) return;
    const n = wordsOf(pieces[tapped]).length;
    const pick: TextPick = sel && !(sel.from === 0 && sel.to === n - 1) ? { i: tapped, ...sel } : { i: tapped };
    const [a, b] = spanOf(pick, n);
    setPicks((prev) => {
      const next = { ...prev };
      // A word is one field: anything overlapping these words on this piece lets go.
      for (const f of Object.keys(next) as TemplateField[]) {
        const pk = next[f]!;
        if (pk.i !== tapped) continue;
        const [c, d] = spanOf(pk, n);
        if (c <= b && a <= d) delete next[f];
      }
      if (field) next[field] = pick;
      return next;
    });
    if (field) setEdits((e) => ({ ...e, [field]: undefined }));
    setTapped(null);
    setSel(null);
  };

  /** What each linked field reads as, for the review list. */
  const linkedValues = pieces ? valuesFromPicks(pieces, picks) : {};
  const shown = (f: TemplateField): string => {
    const v = linkedValues;
    switch (f) {
      case "amount":
        return v.amount != null ? formatAmount(v.amount) : "";
      case "date":
        return v.date ? `${formatDisplayDate(v.date)}${v.time ? `, ${v.time}` : ""}` : "";
      case "account":
        return v.account ? `${v.account.label}${v.account.last4 ? ` ··${v.account.last4}` : ""}` : "";
      default:
        return (v[f] as string | undefined) ?? "";
    }
  };

  /** Use the linked text as the transaction's details, and save the layout as a template if asked. */
  const applyLinks = async () => {
    if (!pieces || !guess) return;
    if (Object.keys(picks).length === 0) {
      toast("Tap a value on the picture first");
      return;
    }
    let values: TemplateValues = valuesFromPicks(pieces, picks);
    for (const [f, text] of Object.entries(edits) as [TemplateField, string | undefined][]) {
      if (text != null && text !== shown(f)) values = { ...values, ...parseEdit(f, text) };
    }
    const g = withTemplate(guess, kind, values);
    setGuess(g);
    if (!saveAsTemplate) {
      setTeaching(false);
      return;
    }
    setSaving(true);
    try {
      const learned = buildTemplate(pieces, picks);
      const name = templateName.trim() || guess.app || "Picture template";
      const id = await saveImageTemplate({
        id: template?.id,
        name,
        kind,
        anchors: learned.anchors,
        fields: learned.fields,
        sampleText: guess.text,
        sample: { pieces, picks },
      });
      setTemplate({ id, name, kind, anchors: learned.anchors, fields: learned.fields, sampleText: guess.text, sample: { pieces, picks }, useCount: 0, updatedAt: "" });
      toast(`Saved as "${name}". Pictures like this will be read this way.`);
    } catch (e) {
      toast(e instanceof Error ? `Couldn't save the template: ${e.message}` : "Couldn't save the template");
    } finally {
      setSaving(false);
      setTeaching(false);
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
  const fieldsOn = (i: number) => (Object.keys(picks) as TemplateField[]).filter((f) => picks[f]!.i === i);

  // ─── Teaching: the picture with every piece of text tappable ───
  if (teaching && pieces && uri) {
    const height = width * aspect;
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ ...stackOptions, headerShown: true, title: "Link text to fields" }} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            Tap a value on the picture, then pick which field it is. What Arth already found is marked; tap it to change.
          </Text>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%" }}>
            {width > 0 && (
              <View style={{ width, height }}>
                <Image source={{ uri }} style={{ width, height, borderRadius: 8 }} resizeMode="stretch" />
                {/* Every piece of text is a tap target. */}
                {pieces.map((p, i) => {
                  const linked = fieldsOn(i).length > 0;
                  const on = tapped === i;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => openPiece(i)}
                      style={{
                        position: "absolute",
                        left: p.x * width - 3,
                        top: p.y * height - 3,
                        width: p.width * width + 6,
                        height: Math.max(p.height * height + 6, 22),
                        borderRadius: 4,
                        borderWidth: on ? 2 : 1,
                        borderColor: on ? theme.warning : linked ? theme.alpha("primary", 0.6) : theme.alpha("primary", 0.35),
                        backgroundColor: on ? theme.alpha("warning", 0.12) : undefined,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.text}${linked ? `, ${fieldsOn(i).map(fieldLabel).join(", ")}` : ""}`}
                    />
                  );
                })}
                {/* What's linked: a box round exactly that text (a whole line or some words). */}
                {(Object.keys(picks) as TemplateField[]).map((f) => {
                  const b = pickBox(pieces, picks[f]!);
                  if (!b) return null;
                  return (
                    <View
                      key={`box-${f}`}
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: b.x * width - 3,
                        top: b.y * height - 3,
                        width: b.width * width + 6,
                        height: Math.max(b.height * height + 6, 22),
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: theme.primary,
                        backgroundColor: theme.alpha("primary", 0.15),
                      }}
                    />
                  );
                })}
                {/* Their tags sit above the box, on one line, never over the text. */}
                {(Object.keys(picks) as TemplateField[]).map((f) => {
                  const b = pickBox(pieces, picks[f]!);
                  if (!b) return null;
                  const label = fieldLabel(f);
                  const tagW = label.length * 6.4 + 10;
                  return (
                    <View
                      key={`tag-${f}`}
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: Math.max(0, Math.min(b.x * width - 3, width - tagW)),
                        top: Math.max(0, b.y * height - 21),
                        width: tagW,
                        height: 17,
                        borderRadius: 4,
                        backgroundColor: theme.primary,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text numberOfLines={1} style={{ color: theme.primaryForeground, fontSize: 11, fontWeight: "700" }}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <Card className="mt-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">What it found</Text>
            {(Object.keys(picks) as TemplateField[]).length === 0 ? (
              <Text className="text-sm text-muted-foreground">Nothing yet - tap a value on the picture.</Text>
            ) : (
              <Text className="text-xs text-muted-foreground mb-1">Tap a value to correct it. A correction is for this transaction only.</Text>
            )}
            {TEMPLATE_FIELDS.filter((d) => picks[d.field] != null).map((d) => (
              <View key={d.field} className="flex-row items-center py-1.5 border-b border-border">
                <Text className="text-sm text-muted-foreground" style={{ width: 120 }}>{fieldLabel(d.field)}</Text>
                <TextInput
                  value={edits[d.field] ?? shown(d.field)}
                  onChangeText={(t) => setEdits((e) => ({ ...e, [d.field]: t }))}
                  placeholder="Not read - type it"
                  placeholderTextColor={theme.mutedForeground}
                  keyboardType={d.field === "amount" ? "decimal-pad" : "default"}
                  autoCapitalize={d.field === "vpa" || d.field === "ownVpa" ? "none" : "sentences"}
                  className="text-sm text-foreground flex-1 rounded-md px-2 py-1 border border-border"
                  accessibilityLabel={fieldLabel(d.field)}
                />
              </View>
            ))}
            <Pressable
              onPress={() => setSaveAsTemplate((v) => !v)}
              className="flex-row items-start mt-4"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: saveAsTemplate }}
            >
              <Ionicons name={saveAsTemplate ? "checkbox" : "square-outline"} size={20} color={saveAsTemplate ? theme.primary : theme.faintForeground} />
              <Text className="text-sm text-foreground ml-2 flex-1 leading-5">
                {template ? `Update the template "${template.name}"` : "Save as a template"}
                <Text className="text-xs text-muted-foreground">{"\n"}The next picture like this is read the same way, by itself.</Text>
              </Text>
            </Pressable>
            {saveAsTemplate && (
              <TextInput
                value={templateName}
                onChangeText={setTemplateName}
                placeholder="Template name, e.g. ICICI Bank payment"
                placeholderTextColor={theme.mutedForeground}
                className="text-sm text-foreground rounded-lg px-3 py-2 border border-border mt-2"
                accessibilityLabel="Template name"
              />
            )}
            <Button title="Use these" onPress={() => void applyLinks()} loading={saving} className="mt-4" />
            <Button title="Cancel" variant="ghost" onPress={() => setTeaching(false)} className="mt-1" />
          </Card>
        </ScrollView>

        {tapped != null && pieces[tapped] && (() => {
          const words = wordsOf(pieces[tapped]);
          const text = selectedText();
          return (
            <View className="absolute left-0 right-0 bottom-0 px-4 pt-3 pb-6 border-t border-border" style={{ backgroundColor: theme.card }}>
              {words.length > 1 ? (
                <>
                  <Text className="text-xs text-muted-foreground">
                    {`This line has ${words.length} parts. Tap the words that make the field.`}
                  </Text>
                  <View className="flex-row flex-wrap mt-1.5" style={{ gap: 6 }}>
                    {words.map((w, j) => {
                      const on = sel ? j >= sel.from && j <= sel.to : true;
                      return (
                        <Pressable
                          key={j}
                          onPress={() => tapWord(j)}
                          className="rounded-md px-2.5 py-1.5"
                          style={{ borderWidth: on && sel ? 1.5 : 1, borderColor: on && sel ? theme.primary : theme.border, backgroundColor: on && sel ? theme.alpha("primary", 0.1) : undefined }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on && !!sel }}
                        >
                          <Text className="text-xs" style={{ color: on && sel ? theme.primary : theme.foreground }}>{w.text}</Text>
                        </Pressable>
                      );
                    })}
                    {sel && (
                      <Pressable onPress={() => setSel(null)} className="rounded-md px-2.5 py-1.5" accessibilityRole="button">
                        <Text className="text-xs text-muted-foreground">Whole line</Text>
                      </Pressable>
                    )}
                  </View>
                </>
              ) : (
                <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>{text}</Text>
              )}
              <Text className="text-xs text-muted-foreground mt-3">This is the</Text>
              <View className="flex-row flex-wrap mt-1.5" style={{ gap: 6 }}>
                {TEMPLATE_FIELDS.map((d) => {
                  const pk = picks[d.field];
                  const on = !!pk && pk.i === tapped && (sel ? pk.from === sel.from && pk.to === sel.to : pk.from == null);
                  const ok = extractField(d.field, text) != null;
                  return (
                    <Pressable
                      key={d.field}
                      onPress={() => ok && assign(d.field)}
                      disabled={!ok}
                      className="rounded-full px-3 py-1.5"
                      style={{ borderWidth: 1, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.primary : undefined, opacity: ok ? 1 : 0.35 }}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !ok, selected: on }}
                    >
                      <Text className="text-xs font-medium" style={{ color: on ? theme.primaryForeground : theme.foreground }}>{fieldLabel(d.field)}</Text>
                    </Pressable>
                  );
                })}
                {fieldsOn(tapped).length > 0 && (
                  <Pressable onPress={() => assign(null)} className="rounded-full px-3 py-1.5" style={{ borderWidth: 1, borderColor: theme.border }} accessibilityRole="button">
                    <Text className="text-xs font-medium text-muted-foreground">Not this</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => { setTapped(null); setSel(null); }} className="rounded-full px-3 py-1.5" accessibilityRole="button">
                  <Text className="text-xs font-medium text-muted-foreground">Close</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ ...stackOptions, headerShown: true, title: "Add from a picture" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!isTextReaderAvailable && (
          <Card className="mb-3">
            <Text className="text-sm text-foreground">{"Reading pictures needs the full app build; it isn't available here."}</Text>
          </Card>
        )}

        {phase === "pick" && (
          <View className="items-center py-8">
            <Ionicons name="image-outline" size={48} color={theme.primary} />
            <Text className="text-lg font-semibold text-foreground mt-3">{teachFirst ? "Teach Arth a picture layout" : "Add from a payment picture"}</Text>
            <Text className="text-sm text-muted-foreground text-center mt-1 leading-5 px-4">
              {teachFirst
                ? "Pick a payment picture, then tap its values and say what each one is. Pictures like it are then read the same way."
                : "A payment's success screen from Google Pay, PhonePe, Paytm, Amazon Pay, BHIM, CRED or a bank app, or a photo of a receipt. It's read on this phone. Tip: share a screenshot straight to Arth to skip this step."}
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
            <Text className="text-base font-semibold text-foreground">{"Couldn't read that image"}</Text>
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
                <Text className="text-xs ml-1.5" style={{ color: theme.primary }}>{`Read with your template "${template.name}"`}</Text>
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

            {pieces && uri && (!guess.amount || (kind !== "transfer" && !guess.party) || !guess.date) && (
              <Button title="Link the text to fields" variant="outline" onPress={startTeaching} className="mt-4" />
            )}
            <Button title={duplicate || duplicateTransfer ? "Add anyway" : "Continue"} onPress={() => void proceed()} className="mt-3" />
            <Text className="text-xs text-muted-foreground text-center mt-2">You can change anything on the next screen before saving.</Text>

            {pieces && uri && (
              <Pressable onPress={startTeaching} className="mt-4 p-3 rounded-xl flex-row items-center" style={{ backgroundColor: theme.alpha("primary", 0.08) }} accessibilityRole="button">
                <Ionicons name="hand-left-outline" size={18} color={theme.primary} />
                <View className="ml-2.5 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.primary }}>{template ? "Fix the template" : "Something missing or wrong?"}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">Link the text on the picture to the fields, and save it as a template.</Text>
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
