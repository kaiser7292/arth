import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { useTheme } from "@/hooks/use-theme";
import { isTextReaderAvailable, readTextInImage } from "../../modules/arth-text-reader";
import { readReceipt, type ReceiptGuess, type ReceiptKind } from "@/services/receipt/read-receipt";
import {
  findPossibleDuplicate,
  findPossibleDuplicateTransfer,
  getOwnAccounts,
  matchAccount,
  type OwnAccount,
  type PossibleDuplicate,
} from "@/services/receipt/receipt-to-transaction";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

const KINDS: { kind: ReceiptKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: "expense", label: "Expense", icon: "arrow-up-outline" },
  { kind: "credit", label: "Money in", icon: "arrow-down-outline" },
  { kind: "transfer", label: "Transfer", icon: "swap-horizontal" },
  { kind: "committed", label: "EMI / SIP", icon: "repeat-outline" },
];

type Phase = "pick" | "reading" | "read" | "failed";

/**
 * Add a transaction from a payment screenshot (or a shared payment message). The image is read on
 * the phone (modules/arth-text-reader), the receipt reader works out what it is
 * (services/receipt/read-receipt.ts), and this screen shows what was found to confirm: the kind,
 * amount, who, when, the account it matches, and whether it looks already recorded. Continue opens
 * the Add screen filled in; nothing is saved until it's saved there.
 */
export default function FromScreenshotScreen() {
  const router = useRouter();
  const theme = useTheme();
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

  const read = useCallback(async (source: { uri?: string; text?: string }) => {
    setPhase("reading");
    setError(null);
    setShowRead(false);
    try {
      const [lines, own] = await Promise.all([
        source.uri ? readTextInImage(source.uri).then((r) => r.lines) : Promise.resolve(source.text!.split(/\r?\n/)),
        getOwnAccounts(),
      ]);
      const g = readReceipt(lines);
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

  const pick = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (res.canceled || !res.assets?.[0]) return;
    setUri(res.assets[0].uri);
    void read({ uri: res.assets[0].uri });
  }, [read]);

  const from = useMemo(() => (guess ? matchAccount(guess.account, accounts, guess.app) : null), [guess, accounts]);
  const to = useMemo(() => (guess && kind === "transfer" ? matchAccount(guess.toAccount, accounts, guess.app) : null), [guess, accounts, kind]);

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

  const proceed = () => {
    if (!guess) return;
    const description = [guess.app, guess.ref ? `ref ${guess.ref}` : null].filter(Boolean).join(" · ");
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

  const Field = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
    <View className="flex-row items-start py-2.5 border-b border-border">
      <Text className="text-sm text-muted-foreground" style={{ width: 92 }}>{label}</Text>
      <Text className="text-sm flex-1 text-right" style={{ color: muted ? theme.mutedForeground : theme.foreground }}>
        {value}
      </Text>
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ ...stackOptions, headerShown: true, title: "Add from screenshot" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!isTextReaderAvailable && (
          <Card className="mb-3">
            <Text className="text-sm text-foreground">Reading screenshots needs the full app build; it isn't available here.</Text>
          </Card>
        )}

        {phase === "pick" && (
          <View className="items-center py-8">
            <Ionicons name="image-outline" size={48} color={theme.primary} />
            <Text className="text-lg font-semibold text-foreground mt-3">Add from a payment screenshot</Text>
            <Text className="text-sm text-muted-foreground text-center mt-1 leading-5 px-4">
              Google Pay, PhonePe, Paytm, Amazon Pay, BHIM, CRED or a bank app: use the payment's success screen. It's read on
              this phone. Tip: share a screenshot straight to Arth to skip this step.
            </Text>
            <Button title="Choose a screenshot" onPress={() => void pick()} className="mt-5" />
          </View>
        )}

        {uri && phase !== "pick" && (
          <Image source={{ uri }} style={{ width: "100%", height: 220, borderRadius: 12, backgroundColor: theme.alpha("foreground", 0.05) }} resizeMode="contain" />
        )}

        {phase === "reading" && (
          <View className="items-center py-8">
            <ActivityIndicator color={theme.primary} />
            <Text className="text-sm text-muted-foreground mt-3">Reading the screenshot…</Text>
          </View>
        )}

        {phase === "failed" && (
          <Card className="mt-3">
            <Text className="text-base font-semibold text-foreground">Couldn't read that image</Text>
            <Text className="text-sm text-muted-foreground mt-1">{error}</Text>
            <Button title="Choose another" variant="outline" onPress={() => void pick()} className="mt-3" />
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
                  <Field label="From" value={from ? accountName(from) : guess.account ? `${guess.account.label}${guess.account.last4 ? ` ··${guess.account.last4}` : ""} · not matched` : "Pick on the next screen"} muted={!from} />
                  <Field label="To" value={to ? accountName(to) : guess.toAccount ? `${guess.toAccount.label}${guess.toAccount.last4 ? ` ··${guess.toAccount.last4}` : ""} · not matched` : "Pick on the next screen"} muted={!to} />
                </>
              ) : (
                <>
                  <Field label={kind === "credit" ? "From" : "Paid to"} value={guess.party ?? "Not found"} muted={!guess.party} />
                  {guess.vpa && <Field label="UPI ID" value={guess.vpa} />}
                  <Field
                    label={kind === "credit" ? "Into" : "Paid from"}
                    value={from ? accountName(from) : guess.account ? `${guess.account.label}${guess.account.last4 ? ` ··${guess.account.last4}` : ""} · not matched` : "Pick on the next screen"}
                    muted={!from}
                  />
                </>
              )}
              <Field label="When" value={guess.date ? `${formatDisplayDate(guess.date)}${guess.time ? `, ${guess.time}` : ""}` : "Not found"} muted={!guess.date} />
              {guess.ref && <Field label="Reference" value={guess.ref} />}
              {guess.app && <Field label="From app" value={guess.app} />}
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

            <Button title={duplicate || duplicateTransfer ? "Add anyway" : "Continue"} onPress={proceed} className="mt-4" />
            <Text className="text-xs text-muted-foreground text-center mt-2">You can change anything on the next screen before saving.</Text>

            <Pressable onPress={() => setShowRead((v) => !v)} className="mt-4 py-2" accessibilityRole="button">
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
