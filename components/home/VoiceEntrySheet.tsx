import { useEffect, useRef, useState } from "react";

import { Button, Chip, ChipWrap, Sheet, Text } from "@/components/ui";
import { Animated, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { DEFAULT_USER_ID } from "@/constants/app";
import { looksLikeTransfer, matchMerchant, parseVoiceInput, wholeReply } from "@/utils/voice-parser";
import { readSpokenAmount } from "@/utils/spoken-number";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { getPaymentModes } from "@/services/payment-mode";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import { getPersonsWithBalances } from "@/services/hisaab";
import { createTransfer } from "@/services/account-transfer";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { bumpDataVersion } from "@/services/settings";
import { getVoiceSettings } from "@/services/voice-settings";
import { useTheme } from "@/hooks/use-theme";
import { isoDate, todayIso } from "@/utils/local-date";
import { formatExactAmount } from "@/utils/format";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { getNanoStatus } from "@/services/ai/nano";
import { readVoiceWithNano } from "@/services/ai/tasks/read-voice";

/**
 * Voice entry (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 C): say it once, watch the words appear,
 * check one card, done. Replaces the question-by-question interview.
 *
 *   1. Listen: your words show large as you speak (hooks/use-voice-capture.ts).
 *   2. Read: plain rules first (utils/voice-parser.ts); of the engine's guesses, the one that makes
 *      most sense wins. On-device AI only fills what the rules left empty, never holding up the card.
 *   3. One spoken follow-up at most, only when no amount was heard.
 *   4. The card: every field tappable to change. Looks right opens the Add screen filled in.
 *      A transfer saves from the card.
 */

type Phase = "listen" | "amount" | "merchant" | "card" | "saved";

interface VoiceSession {
  sessionType: "expense" | "transfer";
  amount?: number;
  merchant?: string;
  description?: string;
  paymentModeId?: string;
  accountId?: string;
  categoryId?: string;
  dateIso?: string;
  splitPersonId?: string;
  transferFromAccountId?: string;
  transferToAccountId?: string;
}

type Editing = "category" | "mode" | "account" | "date" | "from" | "to" | null;

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Matching helpers ─────────────────────────────────────────────────────────

function words3(t: string): string[] {
  return t.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
}

function wordMatchesName(word: string, name: string): boolean {
  const n = name.toLowerCase();
  return n.length > 2 && (n.includes(word) || word.includes(n));
}

/** Accounts whose bank, label or last digits are in the words. */
function findAllMatchingAccounts(text: string, accounts: FinancialAccount[]): FinancialAccount[] {
  const t = text.toLowerCase().trim();
  const wds = words3(t);
  const byDigits = accounts.filter((a) => {
    if (!a.account_identifier || a.account_identifier.length < 3) return false;
    return t.includes(a.account_identifier.slice(-4)) || t.includes(a.account_identifier.slice(-3));
  });
  if (byDigits.length > 0) return byDigits;
  return accounts.filter((a) => {
    const bank = (a.bank_name ?? "").toLowerCase();
    const label = (a.account_label ?? "").toLowerCase();
    return wds.some((w) => wordMatchesName(w, bank) || wordMatchesName(w, label));
  });
}

function matchPerson(text: string, persons: HisaabPersonWithBalance[]): HisaabPersonWithBalance | undefined {
  const t = text.toLowerCase().trim();
  const exact = persons.find((p) => p.name.toLowerCase() === t);
  if (exact) return exact;
  return persons.find((p) => {
    const n = p.name.toLowerCase();
    return n.length > 2 && (n.includes(t) || t.includes(n));
  });
}

function accountDisplayLabel(a: FinancialAccount | undefined): string {
  if (!a) return "?";
  const last4 = (a.account_identifier ?? "").slice(-4);
  const base = a.account_label || a.bank_name || "Account";
  return last4 && /\d/.test(last4) ? `${base} (${last4})` : base;
}

interface RefData {
  accounts: FinancialAccount[];
  paymentModes: PaymentMode[];
  categories: Category[];
  persons: HisaabPersonWithBalance[];
  merchants: string[];
}

/** Read one sentence into a session. */
function readSentence(said: string, d: RefData): VoiceSession {
  if (looksLikeTransfer(said)) {
    const s: VoiceSession = { sessionType: "transfer", amount: readSpokenAmount(said) };
    const from = said.match(/\bfrom\s+(.+?)(?=\s+to\b|$)/i);
    const to = said.match(/\bto\s+(.+?)(?=\s+from\b|$)/i);
    if (from) {
      const m = findAllMatchingAccounts(from[1], d.accounts);
      if (m.length === 1) s.transferFromAccountId = m[0].id;
    }
    if (to) {
      const m = findAllMatchingAccounts(to[1], d.accounts);
      if (m.length === 1 && m[0].id !== s.transferFromAccountId) s.transferToAccountId = m[0].id;
    }
    return s;
  }
  const parsed = parseVoiceInput(said, {
    merchants: d.merchants,
    categories: d.categories.map((c) => c.name),
    modes: d.paymentModes.map((m) => m.name),
  });
  const s: VoiceSession = {
    sessionType: "expense",
    amount: parsed.amount,
    merchant: parsed.merchant,
    description: parsed.description,
    dateIso: parsed.dateIso,
    categoryId: parsed.category ? d.categories.find((c) => c.name === parsed.category)?.id : undefined,
    paymentModeId: parsed.paymentMode ? d.paymentModes.find((m) => m.name === parsed.paymentMode)?.id : undefined,
  };
  const accts = findAllMatchingAccounts(said, d.accounts);
  if (accts.length === 1) s.accountId = accts[0].id;
  if (/\bsplit\b/i.test(said)) {
    const after = said.match(/\bsplit\s+(?:with\s+)?(\w+)/i);
    const p = (after && matchPerson(after[1], d.persons)) || words3(said).map((w) => matchPerson(w, d.persons)).find(Boolean);
    if (p) s.splitPersonId = p.id;
  }
  return s;
}

/** How much sense a reading makes, for picking among the engine's guesses. */
function sense(s: VoiceSession, d: RefData): number {
  let n = 0;
  if (s.amount != null) n += 4;
  if (s.merchant && d.merchants.includes(s.merchant)) n += 2;
  else if (s.merchant) n += 1;
  if (s.categoryId) n += 1;
  if (s.paymentModeId) n += 1;
  if (s.transferFromAccountId) n += 1;
  if (s.transferToAccountId) n += 1;
  return n;
}

const dayOffset = (n: number) => isoDate(new Date(Date.now() - n * 864e5));
function dateLabel(dateIso: string | undefined): string {
  if (!dateIso || dateIso === todayIso()) return "Today";
  if (dateIso === dayOffset(1)) return "Yesterday";
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const AMOUNT_HINTS = ["rupees", "hundred", "thousand", "lakh"];

// ── Component ────────────────────────────────────────────────────────────────

export function VoiceEntrySheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [phase, setPhase] = useState<Phase>("listen");
  const phaseRef = useRef<Phase>("listen");
  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const [session, setSession] = useState<VoiceSession>({ sessionType: "expense" });
  const sessionRef = useRef<VoiceSession>({ sessionType: "expense" });
  const update = (s: VoiceSession) => {
    sessionRef.current = s;
    setSession(s);
  };
  const [heard, setHeard] = useState("");
  const [thinking, setThinking] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The one follow-up for a missing amount has been asked. */
  const askedAmountRef = useRef(false);

  const [data, setData] = useState<RefData>({ accounts: [], paymentModes: [], categories: [], persons: [], merchants: [] });
  const dataRef = useRef(data);
  dataRef.current = data;

  /** Counts sentences sent to on-device AI, so only the latest answer is used. */
  const aiAskRef = useRef(0);
  /** The sheet is showing: a spoken question finishing after close mustn't start the mic. */
  const openRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Promise.all([
      getActiveAccounts(DEFAULT_USER_ID),
      getPaymentModes(DEFAULT_USER_ID),
      getCategories(DEFAULT_USER_ID),
      getPersonsWithBalances(DEFAULT_USER_ID),
      getDistinctMerchantNames(DEFAULT_USER_ID).catch(() => [] as string[]),
    ])
      .then(([accounts, paymentModes, categories, persons, merchants]) => {
        const d = { accounts, paymentModes, categories, persons, merchants };
        dataRef.current = d;
        setData(d);
      })
      .catch(() => {});
  }, [visible]);

  /** Your own words, so the engine expects them (Android 13+). */
  const hints = (): string[] => {
    const d = dataRef.current;
    return [
      ...d.merchants.slice(0, 50),
      ...d.categories.map((c) => c.name),
      ...d.paymentModes.map((m) => m.name),
      ...d.accounts.map((a) => a.bank_name ?? "").filter(Boolean),
      ...d.persons.map((p) => p.name),
    ];
  };

  const speak = (text: string, then: () => void) => {
    const settings = getVoiceSettings();
    if (!settings.speakBack) {
      then();
      return;
    }
    Speech.speak(text, { voice: settings.voiceIdentifier ?? undefined, language: "en-IN", onDone: then, onError: then });
  };

  /** On-device AI for what the rules left empty: fills the card when it answers, 3 s at most. */
  const fillWithAi = (said: string, s: VoiceSession) => {
    const needs = !s.merchant || !s.categoryId || !s.paymentModeId;
    if (s.sessionType !== "expense" || !needs || !isAiJobOn("voice")) return;
    const asked = ++aiAskRef.current;
    const d = dataRef.current;
    setThinking(true);
    void (async () => {
      const ready = (await getNanoStatus().catch(() => "unavailable")) === "available";
      const r = ready ? await readVoiceWithNano(said, d.categories.map((c) => c.name), d.paymentModes.map((m) => m.name)) : null;
      if (asked !== aiAskRef.current) return;
      setThinking(false);
      if (!r) return;
      const cur = sessionRef.current;
      // Only what's still empty: anything changed on the card stays.
      update({
        ...cur,
        amount: cur.amount ?? r.amount ?? undefined,
        merchant: cur.merchant ?? r.merchant ?? undefined,
        categoryId: cur.categoryId ?? (r.category ? d.categories.find((c) => c.name === r.category)?.id : undefined),
        paymentModeId: cur.paymentModeId ?? (r.mode ? d.paymentModes.find((m) => m.name === r.mode)?.id : undefined),
      });
    })();
  };

  const openForm = (s: VoiceSession) => {
    aiAskRef.current++;
    capture.abort();
    Speech.stop();
    onClose();
    const p: Record<string, string> = {};
    if (s.amount != null) p.prefillAmount = String(s.amount);
    if (s.merchant) p.prefillMerchant = s.merchant;
    if (s.description) p.prefillDescription = s.description;
    if (s.paymentModeId) p.prefillPaymentModeId = s.paymentModeId;
    if (s.accountId) p.prefillAccountId = s.accountId;
    if (s.categoryId) p.prefillCategoryId = s.categoryId;
    if (s.dateIso) p.prefillDate = s.dateIso;
    if (s.splitPersonId) p.prefillSplitPersonId = s.splitPersonId;
    setTimeout(() => router.push({ pathname: "/expense/add", params: p }), 300);
  };

  const capture = useVoiceCapture({
    onFinal: (guesses) => {
      const d = dataRef.current;
      const p = phaseRef.current;
      setHeard(guesses[0]);
      if (p === "amount") {
        const amount = guesses.map((g) => readSpokenAmount(g)).find((a) => a != null);
        update({ ...sessionRef.current, amount: amount ?? sessionRef.current.amount });
        go("card");
        return;
      }
      if (p === "merchant") {
        const g = guesses[0].trim();
        const merchant = guesses.map((x) => matchMerchant(x, d.merchants)).find(Boolean) ?? (wholeReply(g) ? undefined : g.replace(/^(at|from)\s+/i, ""));
        update({ ...sessionRef.current, merchant: merchant || sessionRef.current.merchant });
        go("card");
        return;
      }
      if (p !== "listen") return;
      // "Done" alone: open the form with what there is.
      if (wholeReply(guesses[0]) === "done") {
        openForm(sessionRef.current);
        return;
      }
      const readings = guesses.map((g) => ({ g, s: readSentence(g, d) }));
      let best = readings[0];
      for (const r of readings) if (sense(r.s, d) > sense(best.s, d)) best = r;
      update(best.s);
      setHeard(best.g);
      fillWithAi(best.g, best.s);
      if (best.s.amount == null && !askedAmountRef.current) {
        askedAmountRef.current = true;
        go("amount");
        speak("How much?", () => {
          if (openRef.current && phaseRef.current === "amount") void capture.start(AMOUNT_HINTS);
        });
        return;
      }
      go("card");
    },
  });

  // Open/close handling
  useEffect(() => {
    aiAskRef.current++;
    openRef.current = visible;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    if (visible) {
      update({ sessionType: "expense" });
      go("listen");
      setHeard("");
      setThinking(false);
      setEditing(null);
      setSaveError(null);
      askedAmountRef.current = false;
      const timer = setTimeout(() => void capture.start(hints()), 350);
      return () => clearTimeout(timer);
    }
    Speech.stop();
    capture.abort();
    phaseRef.current = "listen";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const listening = capture.state === "listening";
  useEffect(() => {
    if (!listening) {
      pulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulseAnim]);

  const saveTransfer = async () => {
    const s = sessionRef.current;
    if (s.amount == null || !s.transferFromAccountId || !s.transferToAccountId) return;
    setSaveError(null);
    try {
      await createTransfer({
        userId: DEFAULT_USER_ID,
        fromAccountId: s.transferFromAccountId,
        toAccountId: s.transferToAccountId,
        amount: s.amount,
        date: s.dateIso ?? todayIso(),
        source: "manual",
      });
      bumpDataVersion();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      go("saved");
      closeTimerRef.current = setTimeout(onClose, 1600);
    } catch {
      setSaveError("Couldn't save the transfer. Please try again.");
    }
  };

  const handleCancel = () => {
    openRef.current = false;
    phaseRef.current = "listen";
    aiAskRef.current++;
    Speech.stop();
    capture.abort();
    onClose();
  };

  const startOver = () => {
    aiAskRef.current++;
    Speech.stop();
    update({ sessionType: "expense" });
    setHeard("");
    setEditing(null);
    setThinking(false);
    askedAmountRef.current = false;
    go("listen");
    void capture.start(hints());
  };

  /** Say just this field again. */
  const reListen = (field: "amount" | "merchant") => {
    Speech.stop();
    setEditing(null);
    go(field);
    void capture.start(field === "amount" ? AMOUNT_HINTS : dataRef.current.merchants.slice(0, 80));
  };

  // ── Labels ────────────────────────────────────────────────────────────────
  const { accounts, paymentModes, categories, persons } = data;
  const isTransfer = session.sessionType === "transfer";
  const acct = (id?: string) => accounts.find((a) => a.id === id);
  const catLbl = categories.find((c) => c.id === session.categoryId)?.name;
  const pmLbl = paymentModes.find((m) => m.id === session.paymentModeId)?.name;
  const personLbl = persons.find((p) => p.id === session.splitPersonId)?.name;

  if (phase === "saved") {
    return (
      <Sheet visible={visible} onClose={handleCancel} maxHeightPct={40}>
        <View className="items-center justify-center px-6 py-12">
          <Ionicons name="checkmark-circle" size={56} color={accentColor} />
          <Text className="text-heading font-bold text-foreground mt-4">Transfer saved</Text>
          {session.amount != null && (
            <Text className="text-meta text-muted-foreground mt-2 text-center">
              {formatExactAmount(session.amount)} from {accountDisplayLabel(acct(session.transferFromAccountId))} to{" "}
              {accountDisplayLabel(acct(session.transferToAccountId))}
            </Text>
          )}
        </View>
      </Sheet>
    );
  }

  const title = phase === "card" ? (isTransfer ? "Check the transfer" : "Check and save") : "Say it once";
  const fieldPhase = phase === "amount" || phase === "merchant";
  const prompt = phase === "amount" ? "How much?" : phase === "merchant" ? "Where?" : listening ? "Listening…" : capture.error ? "" : "Tap the mic to speak";
  const retry = () => (fieldPhase ? reListen(phase as "amount" | "merchant") : startOver());

  // ── Listening ─────────────────────────────────────────────────────────────
  const listenView = (
    <View className="items-center px-6 pt-2 pb-4">
      <Animated.View
        style={{
          opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
          transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
        }}
      >
        <Pressable
          onPress={listening ? capture.stop : retry}
          accessibilityRole="button"
          accessibilityLabel={listening ? "Done speaking" : "Start speaking"}
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: listening ? `${theme.danger}18` : `${accentColor}14`,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: listening ? theme.danger : `${accentColor}40`,
          }}
        >
          <Ionicons name={listening ? "radio-button-on" : "mic-outline"} size={32} color={listening ? theme.danger : accentColor} />
        </Pressable>
      </Animated.View>
      {prompt ? <Text className="mt-3 text-meta font-medium text-muted-foreground">{prompt}</Text> : null}
      {/* Your words, large, as you speak */}
      {capture.live ? (
        <Text className="mt-3 text-heading font-semibold text-foreground text-center" numberOfLines={4}>
          {capture.live}
        </Text>
      ) : null}
      {listening && !capture.live && phase === "listen" && (
        <Text className="mt-2 text-label text-faint-foreground text-center">Try: “450 at Swiggy for lunch, GPay, yesterday”</Text>
      )}
      {capture.error && (
        <Pressable onPress={retry} accessibilityRole="button" className="mt-3 px-4">
          <Text className="text-meta text-center" style={{ color: theme.danger }}>
            {capture.error}
          </Text>
        </Pressable>
      )}
      {listening && (
        <View className="w-full mt-4">
          <Button title="Done" variant="outline" onPress={capture.stop} />
        </View>
      )}
      {!listening && fieldPhase && (
        <Pressable onPress={() => go("card")} className="mt-3" accessibilityRole="button">
          <Text className="text-meta font-semibold" style={{ color: accentColor }}>
            Back to the card
          </Text>
        </Pressable>
      )}
    </View>
  );

  // ── The card ──────────────────────────────────────────────────────────────
  const row = (key: string, icon: keyof typeof Ionicons.glyphMap, label: string, value: string | undefined, onPress: () => void, missing = "Tap to choose") => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? missing}. Tap to change`}
      className="flex-row items-center py-3 border-b border-border"
    >
      <Ionicons name={icon} size={18} color={value ? accentColor : colors.textSecondary} />
      <Text className="text-meta text-muted-foreground ml-3 w-24">{label}</Text>
      <Text className={`flex-1 text-body ${value ? "font-semibold text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
        {value ?? missing}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
  );

  const pick = (field: Editing) => setEditing((e) => (e === field ? null : field));
  const choose = (patch: Partial<VoiceSession>) => {
    update({ ...sessionRef.current, ...patch });
    setEditing(null);
  };
  const picker = (field: Exclude<Editing, null>) => {
    if (editing !== field) return null;
    if (field === "category")
      return (
        <ChipWrap className="py-2">
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} on={c.id === session.categoryId} onPress={() => choose({ categoryId: c.id })} />
          ))}
        </ChipWrap>
      );
    if (field === "mode")
      return (
        <ChipWrap className="py-2">
          {paymentModes.map((m) => (
            <Chip key={m.id} label={m.name} on={m.id === session.paymentModeId} onPress={() => choose({ paymentModeId: m.id })} />
          ))}
        </ChipWrap>
      );
    if (field === "date")
      return (
        <ChipWrap className="py-2">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => {
            const d = dayOffset(n);
            return <Chip key={d} label={dateLabel(d)} on={(session.dateIso ?? todayIso()) === d} onPress={() => choose({ dateIso: n === 0 ? undefined : d })} />;
          })}
        </ChipWrap>
      );
    const key = field === "account" ? "accountId" : field === "from" ? "transferFromAccountId" : "transferToAccountId";
    return (
      <ChipWrap className="py-2">
        {accounts.map((a) => (
          <Chip key={a.id} label={accountDisplayLabel(a)} on={a.id === session[key]} onPress={() => choose({ [key]: a.id })} />
        ))}
      </ChipWrap>
    );
  };

  const transferReady =
    isTransfer && session.amount != null && !!session.transferFromAccountId && !!session.transferToAccountId && session.transferFromAccountId !== session.transferToAccountId;

  const cardView = (
    <View className="px-5">
      {heard ? (
        <Text className="text-meta italic text-muted-foreground mb-1" numberOfLines={2}>
          “{heard}”
        </Text>
      ) : null}
      {thinking && <Text className="text-label text-faint-foreground mb-1">Thinking… on-device AI may fill in the rest</Text>}
      {row("amount", "cash-outline", "Amount", session.amount != null ? formatExactAmount(session.amount) : undefined, () => reListen("amount"), "Tap and say it")}
      {isTransfer ? (
        <>
          {row("from", "arrow-up-circle-outline", "From", session.transferFromAccountId ? accountDisplayLabel(acct(session.transferFromAccountId)) : undefined, () => pick("from"))}
          {picker("from")}
          {row("to", "arrow-down-circle-outline", "To", session.transferToAccountId ? accountDisplayLabel(acct(session.transferToAccountId)) : undefined, () => pick("to"))}
          {picker("to")}
        </>
      ) : (
        <>
          {row("merchant", "storefront-outline", "Where", session.merchant, () => reListen("merchant"), "Tap and say it")}
          {row("category", "pricetag-outline", "Category", catLbl, () => pick("category"))}
          {picker("category")}
          {row("mode", "wallet-outline", "Paid with", pmLbl, () => pick("mode"))}
          {picker("mode")}
          {row("account", "business-outline", "Account", session.accountId ? accountDisplayLabel(acct(session.accountId)) : undefined, () => pick("account"))}
          {picker("account")}
        </>
      )}
      {row("date", "calendar-outline", "Date", dateLabel(session.dateIso), () => pick("date"))}
      {picker("date")}
      {!isTransfer && session.description
        ? row("note", "document-text-outline", "Note", session.description, () => update({ ...sessionRef.current, description: undefined }))
        : null}
      {!isTransfer && personLbl ? row("split", "people-outline", "Split with", personLbl, () => update({ ...sessionRef.current, splitPersonId: undefined })) : null}
      {saveError && (
        <Text className="text-meta mt-2" style={{ color: theme.danger }}>
          {saveError}
        </Text>
      )}
      <View className="mt-4" style={{ gap: 10 }}>
        {isTransfer ? (
          <Button title="Save transfer" onPress={saveTransfer} disabled={!transferReady} />
        ) : (
          <Button title="Looks right" onPress={() => openForm(sessionRef.current)} />
        )}
        <Button title="Say it again" variant="outline" onPress={startOver} />
      </View>
      {!isTransfer && <Text className="text-label text-faint-foreground text-center mt-2">Opens the Add screen filled in; tap Save there.</Text>}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={handleCancel} maxHeightPct={85}>
      <View className="flex-row items-center justify-between px-5 pt-5 pb-2">
        <Text className="text-heading font-bold text-foreground">{title}</Text>
        <Pressable onPress={handleCancel} className="p-1" accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {phase === "card" ? cardView : listenView}
        {phase === "listen" && !listening && (
          <View className="px-5">
            <Button title="Open the Add screen" variant="outline" onPress={() => openForm(sessionRef.current)} />
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}
