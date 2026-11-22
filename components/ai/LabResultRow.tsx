import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Chip, MoneyChip, Text, type MoneyToneName } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { RunRow } from "@/services/ai/lab-runner";
import type { AccountLink, AiReadSms, SmsEvent } from "@/services/ai/tasks/read-sms";
import { formatDisplayDate } from "@/utils/date";

export type { RunRow };

/** Pieces of the On-device AI lab (app/settings/ai-lab.tsx), shared with its preview page. */

export const EVENT_TEXT: Record<SmsEvent, string> = {
  spend: "Spend",
  income: "Income",
  refund: "Refund",
  own_transfer: "Own transfer",
  fd_open: "FD opened",
  fd_close: "FD closed",
  card_payment: "Card bill paid",
  loan_emi: "Loan EMI",
  investment: "Investment",
  wallet_topup: "Wallet top-up",
  not_txn: "Not a transaction",
};

export const MOVED: ReadonlySet<SmsEvent> = new Set(["own_transfer", "fd_open", "fd_close", "card_payment", "wallet_topup"]);

export function toneFor(r: AiReadSms): MoneyToneName {
  if (r.event && MOVED.has(r.event)) return "moved";
  if (r.event === "income" || r.event === "refund") return "in";
  return r.type === "credit" ? "in" : "out";
}

export type Outcome = "transaction" | "not_transaction" | "rejected" | "error";

export const outcomeOf = (r: RunRow): Outcome | null => (r.error ? "error" : (r.outcome?.kind ?? null));
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function side(l: AccountLink | null): string {
  if (!l) return "someone else";
  if (!l.account) return "a new account";
  const a = l.account;
  return `${a.name} ${a.kind}${a.digits ? ` ••${a.digits}` : ""}`;
}

/** One message's result: what it was, the amount, and (opened) the SMS and the model's answer. */
export function ResultRow({ row, open, onToggle, last }: { row: RunRow; open: boolean; onToggle: () => void; last?: boolean }) {
  const theme = useTheme();
  const kind = outcomeOf(row);
  const tx = row.outcome?.kind === "transaction" ? row.outcome.result : null;

  const icon: keyof typeof Ionicons.glyphMap =
    kind === "transaction" ? "checkmark" : kind === "not_transaction" ? "remove" : kind === "rejected" ? "alert" : kind === "error" ? "close" : "ellipsis-horizontal";
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
        </View>
      ) : null}
    </Pressable>
  );
}

