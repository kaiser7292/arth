import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Button, Chip, MoneyChip, Text, type MoneyToneName } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { RunRow } from "@/services/ai/lab-runner";
import type { AccountLink, AiReadSms, Channel, SmsEvent } from "@/services/ai/tasks/read-sms";
import { formatDisplayDate } from "@/utils/date";

export type { RunRow };

/** Pieces of the On-device AI lab (app/settings/ai-lab.tsx), shared with its preview page. */

export const EVENT_TEXT: Record<SmsEvent, string> = {
  spend: "Spend",
  bill: "Bill",
  salary: "Salary",
  income: "Income",
  interest: "Interest",
  dividend: "Dividend",
  refund: "Refund",
  cashback: "Cashback",
  reversal: "Reversal",
  own_transfer: "Own transfer",
  card_payment: "Card bill paid",
  loan_emi: "Loan EMI",
  fd_open: "FD opened",
  fd_close: "FD closed",
  sip: "SIP",
  investment: "Investment",
  investment_withdrawal: "Investment withdrawn",
  insurance: "Insurance",
  tax: "Tax",
  atm_cash: "ATM cash",
  wallet_topup: "Wallet top-up",
  fee: "Fee",
  not_txn: "Not a transaction",
};

const CHANNEL_TEXT: Record<Channel, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  neft: "NEFT",
  imps: "IMPS",
  rtgs: "RTGS",
  nach: "NACH",
  atm: "ATM",
  cheque: "Cheque",
  wallet: "Wallet",
};

export const MOVED: ReadonlySet<SmsEvent> = new Set(["own_transfer", "fd_open", "fd_close", "card_payment", "wallet_topup"]);
const IN_EVENTS: ReadonlySet<SmsEvent> = new Set(["salary", "income", "interest", "dividend", "refund", "cashback", "reversal", "investment_withdrawal"]);

export function toneFor(r: AiReadSms): MoneyToneName {
  if (r.event && MOVED.has(r.event)) return "moved";
  if (r.event && IN_EVENTS.has(r.event)) return "in";
  return r.type === "credit" ? "in" : "out";
}

export type Outcome = "transaction" | "not_transaction" | "ignored" | "rejected" | "error";

export const outcomeOf = (r: RunRow): Outcome | null => (r.error ? "error" : (r.outcome?.kind ?? null));
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function side(l: AccountLink | null): string {
  if (!l) return "someone else";
  if (!l.account) return "a new account";
  const a = l.account;
  return `${a.name} ${a.kind}${a.digits ? ` ••${a.digits}` : ""}`;
}

/** One message's result: what it was, the amount, and (opened) the SMS and the model's answer. */
export function ResultRow({
  row,
  open,
  onToggle,
  last,
  onAdd,
  adding,
  onOpenCatchUp,
}: {
  row: RunRow;
  open: boolean;
  onToggle: () => void;
  last?: boolean;
  /** "Add to Catch Up": shown on a reading the user can add (a scanned message, not a pasted one). */
  onAdd?: () => void;
  adding?: boolean;
  onOpenCatchUp?: () => void;
}) {
  const theme = useTheme();
  const kind = outcomeOf(row);
  const tx = row.outcome?.kind === "transaction" ? row.outcome.result : null;

  const icon: keyof typeof Ionicons.glyphMap =
    kind === "transaction" ? "checkmark" : kind === "not_transaction" ? "remove" : kind === "ignored" ? "eye-off-outline" : kind === "rejected" ? "alert" : kind === "error" ? "close" : "ellipsis-horizontal";
  const role = kind === "transaction" ? "success" : kind === "rejected" ? "warning" : kind === "error" ? "danger" : "mutedForeground";
  const color = theme[role];

  const title = tx
    ? tx.event
      ? EVENT_TEXT[tx.event]
      : tx.type === "credit"
        ? "Money in"
        : "Money out"
    : kind === "not_transaction"
      ? "Not a transaction"
      : row.outcome?.kind === "ignored"
        ? `Ignored account · ${row.outcome.account.name} ••${row.outcome.account.digits ?? ""}`
      : kind === "rejected"
        ? "Rejected by the checks"
        : kind === "error"
          ? "No answer"
          : "Waiting";
  const meta = [row.sender, row.date ? formatDisplayDate(new Date(row.date)) : null, row.ms != null ? secs(row.ms) : null]
    .filter(Boolean)
    .join(" · ");
  const warnings = row.outcome?.kind === "transaction" ? row.outcome.warnings : [];
  const problems = row.outcome?.kind === "rejected" ? row.outcome.problems : [];

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      className={`py-3 ${last ? "" : "border-b border-border"}`}
    >
      <View className="flex-row items-center">
        <View className="w-9 h-9 rounded-control items-center justify-center mr-3" style={{ backgroundColor: theme.alpha(role, 0.12) }}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <View className="flex-1 mr-2">
          <Text className="text-body font-medium text-foreground" numberOfLines={1}>
            {title}
            {tx?.merchant ? <Text className="text-body text-muted-foreground"> · {tx.merchant}</Text> : null}
          </Text>
          <Text className="text-meta text-muted-foreground mt-0.5" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {tx ? <MoneyChip amount={tx.amount} tone={toneFor(tx)} /> : null}
      </View>

      {tx && (tx.from || tx.to || tx.last4) ? (
        <View className="flex-row items-center flex-wrap mt-2 ml-12" style={{ gap: 6 }}>
          {tx.from || tx.to ? (
            <Text className="text-meta text-muted-foreground">
              {side(tx.from)} → {side(tx.to)}
            </Text>
          ) : (
            <Text className="text-meta text-muted-foreground">Account ••{tx.last4}</Text>
          )}
          {[tx.from, tx.to].some((l) => l?.account && !l.inSms) ? <Chip variant="status" label="from your accounts" tone="primary" /> : null}
        </View>
      ) : null}
      {tx && (tx.auto || tx.channel || tx.scheme || tx.time || tx.fx) ? (
        <View className="flex-row items-center flex-wrap mt-2 ml-12" style={{ gap: 6 }}>
          {tx.auto ? <Chip variant="status" label={tx.auto.sure ? "Autopay" : "Autopay?"} tone="primary" /> : null}
          {tx.channel ? <Chip variant="status" label={CHANNEL_TEXT[tx.channel]} /> : null}
          {tx.scheme ? <Chip variant="status" label={tx.scheme} /> : null}
          {tx.time ? <Chip variant="status" label={tx.time} /> : null}
          {tx.fx ? <Chip variant="status" label={`${tx.fx.currency} ${tx.fx.amount}`} tone="accent" /> : null}
        </View>
      ) : null}
      {problems.length > 0 && !open ? (
        <Text className="text-meta mt-1 ml-12" style={{ color: theme.warning }} numberOfLines={1}>
          {problems[0]}
        </Text>
      ) : null}

      {open ? (
        <View className="mt-3 ml-12" style={{ gap: 8 }}>
          <View className="rounded-control p-3" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">Message</Text>
            <Text className="text-meta text-foreground" selectable>
              {row.body}
            </Text>
          </View>
          {tx?.ref ? <Text className="text-meta text-muted-foreground">Reference {tx.ref}</Text> : null}
          {[...problems, ...warnings].map((w) => (
            <View key={w} className="flex-row items-start">
              <Ionicons name="information-circle-outline" size={14} color={theme.warning} style={{ marginTop: 2, marginRight: 4 }} />
              <Text className="text-meta flex-1" style={{ color: theme.warning }}>
                {w}
              </Text>
            </View>
          ))}
          {row.raw != null ? (
            <View className="rounded-control p-3" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">Model said</Text>
              <Text className="text-meta text-muted-foreground" selectable style={{ fontFamily: "monospace" }}>
                {row.raw || "(nothing)"}
              </Text>
            </View>
          ) : null}
          {row.error ? <Text className="text-meta" style={{ color: theme.danger }}>{row.error}</Text> : null}
          {tx && row.added ? (
            <View className="flex-row items-center">
              <Ionicons
                name={row.added.expenseId ? "checkmark-circle" : "information-circle-outline"}
                size={16}
                color={row.added.expenseId ? theme.success : theme.mutedForeground}
                style={{ marginRight: 6 }}
              />
              <Text className="text-meta text-foreground flex-1">
                {row.added.expenseId ? "Added to Catch Up" : (row.added.note ?? "Arth didn't add it")}
              </Text>
              {row.added.expenseId && onOpenCatchUp ? (
                <Pressable onPress={onOpenCatchUp} accessibilityRole="button" hitSlop={8}>
                  <Text className="text-meta font-semibold text-primary">Open Catch Up</Text>
                </Pressable>
              ) : null}
            </View>
          ) : tx && onAdd ? (
            <View>
              <Button title="Add to Catch Up" variant="secondary" onPress={onAdd} loading={adding} />
              <Text className="text-label text-muted-foreground mt-1.5">
                It goes to Catch Up like any detected transaction: you can still edit it there, or reject it.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

