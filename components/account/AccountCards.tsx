/**
 * The shared parts of the account screens' cards (Savings, Wallets, Pension, Credit cards, Loans;
 * owner, Nov 2026, from the "Arth account cards" design): one summary card at the top (the total
 * first, then what moved it) and one card shape per account (name, balance and change on one line,
 * then at most one note on what the bank's SMS says).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Card, Text } from "@/components/ui";
import { AccountTypeTile } from "@/components/ui/AccountTypeIcon";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";

/** "+₹1,200" / "−₹1,200" (a true minus sign, as on the rest of the app). */
export function signed(n: number): string {
  return `${n < 0 ? "−" : "+"}${formatAmount(Math.abs(n))}`;
}

/** "18 Nov" for a YYYY-MM-DD date. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The pill under a total: which way it moved, and by how much. */
export function ChangeChip({ amount, suffix }: { amount: number; suffix: string }) {
  const theme = useTheme();
  const flat = Math.abs(amount) < 0.5;
  const color = flat ? theme.mutedForeground : amount > 0 ? theme.success : theme.danger;
  return (
    <View className="flex-row items-center rounded-pill px-2.5 py-0.5" style={{ gap: 4, backgroundColor: flat ? theme.alpha("foreground", 0.05) : theme.alpha(amount > 0 ? "success" : "danger", 0.08) }}>
      {!flat && <Ionicons name={amount > 0 ? "arrow-up" : "arrow-down"} size={12} color={color} />}
      <Text className="text-meta font-semibold" style={{ color }}>
        {flat ? `No change ${suffix}` : `${formatAmount(Math.abs(amount))} ${suffix}`}
      </Text>
    </View>
  );
}

/** The summary card: an uppercase label, the total on text-hero, an optional line under it, then the rest. */
export function SummaryCard({
  label,
  amount,
  amountColor,
  amountAside,
  under,
  children,
}: {
  label: string;
  amount: number;
  amountColor?: string;
  /** Small text beside the total ("of ₹4,50,000"). */
  amountAside?: string;
  /** The line under the total: a ChangeChip and a word or two. */
  under?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card className="mx-4 mt-3 mb-2">
      <View style={{ gap: 6 }}>
        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">{label}</Text>
        <View className="flex-row items-baseline flex-wrap" style={{ columnGap: 8 }}>
          <Text className="text-hero font-bold" style={{ color: amountColor ?? theme.foreground }} numberOfLines={1} adjustsFontSizeToFit>
            {formatAmount(amount)}
          </Text>
          {amountAside ? <Text className="text-meta text-muted-foreground">{amountAside}</Text> : null}
        </View>
        {under ? <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>{under}</View> : null}
      </View>
      {children ? <View className="mt-4" style={{ gap: 16 }}>{children}</View> : null}
    </Card>
  );
}

/** One of the two tiles under a total: money in or money out, with what made it up. */
function FlowTile({ dir, label, amount, sub }: { dir: "in" | "out"; label: string; amount: number; sub?: string }) {
  const theme = useTheme();
  const color = dir === "in" ? theme.success : theme.danger;
  return (
    <View className="flex-1 rounded-control p-3" style={{ gap: 4, backgroundColor: theme.background, minWidth: 0 }}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <View className="w-5 h-5 rounded-pill items-center justify-center" style={{ backgroundColor: theme.alpha(dir === "in" ? "success" : "danger", 0.1) }}>
          <Ionicons name={dir === "in" ? "arrow-down" : "arrow-up"} size={11} color={color} />
        </View>
        <Text className="text-meta text-muted-foreground" numberOfLines={1}>{label}</Text>
      </View>
      <Text className="text-heading font-bold" style={{ color }} numberOfLines={1} adjustsFontSizeToFit>
        {dir === "in" ? "+" : "−"}{formatAmount(amount)}
      </Text>
      {sub ? <Text className="text-label text-muted-foreground" numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

export function FlowTiles({
  inLabel = "Inflow",
  inAmount,
  inSub,
  outLabel = "Outflow",
  outAmount,
  outSub,
}: {
  inLabel?: string;
  inAmount: number;
  inSub?: string;
  outLabel?: string;
  outAmount: number;
  outSub?: string;
}) {
  return (
    <View className="flex-row" style={{ gap: 8 }}>
      <FlowTile dir="in" label={inLabel} amount={inAmount} sub={inSub} />
      <FlowTile dir="out" label={outLabel} amount={outAmount} sub={outSub} />
    </View>
  );
}

/** A label and a value under a hairline, at the foot of a summary card. */
export function FootRows({ rows }: { rows: { label: string; value: string; color?: string }[] }) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <View className="border-t border-border pt-3" style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r.label} className="flex-row justify-between" style={{ gap: 12 }}>
          <Text className="text-meta flex-1" style={{ color: r.color ?? theme.mutedForeground }}>{r.label}</Text>
          <Text className="text-meta font-semibold" style={{ color: r.color ?? theme.foreground }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** The card for one account: the whole card opens it. */
export function AccountCard({ onPress, label, children }: { onPress: () => void; label: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-2 rounded-card bg-card border border-border p-4"
      style={{ gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

/** An account's first line: type tile, name and sub-line, then the balance and what changed. */
export function AccountHead({
  type,
  title,
  subtitle,
  amount,
  amountColor,
  change,
  changeText,
}: {
  type: string;
  title: string;
  subtitle?: string | null;
  amount: number | string;
  amountColor?: string;
  /** Signed change this month; green up, red down. */
  change?: number | null;
  /** Text in place of the change ("no change", "11% used"). */
  changeText?: string;
}) {
  const theme = useTheme();
  const flat = change == null || Math.abs(change) < 0.5;
  return (
    <View className="flex-row items-center" style={{ gap: 12 }}>
      <AccountTypeTile type={type} size={40} radius={10} />
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text className="text-body font-bold text-foreground" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className="text-meta text-muted-foreground" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View className="items-end" style={{ maxWidth: "50%" }}>
        <Text className="text-heading font-bold" style={{ color: amountColor ?? theme.foreground }} numberOfLines={1} adjustsFontSizeToFit>
          {typeof amount === "number" ? formatAmount(amount) : amount}
        </Text>
        {changeText != null ? (
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>{changeText}</Text>
        ) : change !== undefined ? (
          <Text className="text-meta font-semibold" numberOfLines={1} style={{ color: flat ? theme.mutedForeground : change! > 0 ? theme.success : theme.danger }}>
            {flat ? "no change" : signed(change!)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Money in against money out for the month, as one split bar with the two amounts under it. */
export function FlowBar({ inflow, outflow, inText, outText }: { inflow: number; outflow: number; inText: string; outText: string }) {
  const theme = useTheme();
  if (inflow <= 0 && outflow <= 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <View className="flex-row rounded-pill overflow-hidden" style={{ height: 6, gap: 2 }}>
        {inflow > 0 && <View className="rounded-pill" style={{ flex: inflow, backgroundColor: theme.success }} />}
        {outflow > 0 && <View className="rounded-pill" style={{ flex: outflow, backgroundColor: theme.danger, opacity: 0.85 }} />}
      </View>
      <View className="flex-row justify-between" style={{ gap: 8 }}>
        <Text className="text-label text-muted-foreground" numberOfLines={1}>{inText}</Text>
        <Text className="text-label text-muted-foreground" numberOfLines={1}>{outText}</Text>
      </View>
    </View>
  );
}

/** A progress bar of a share (0-1), coloured by the caller. */
export function ShareBar({ value, color, height = 6 }: { value: number; color: string; height?: number }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View className="rounded-pill overflow-hidden" style={{ height, backgroundColor: theme.border }}>
      <View className="rounded-pill" style={{ height, width: `${pct * 100}%`, backgroundColor: color }} />
    </View>
  );
}

export type NoteTone = "ok" | "warn" | "info" | "danger";

/** The one line at the foot of an account card: whether the bank's SMS agrees, a due bill, and so on. */
export function CardNote({ tone, text, action, boxed = false }: { tone: NoteTone; text: string; action?: { label: string; onPress: () => void }; boxed?: boolean }) {
  const theme = useTheme();
  const color = tone === "ok" ? theme.success : tone === "warn" ? theme.warning : tone === "danger" ? theme.danger : theme.mutedForeground;
  const icon: keyof typeof Ionicons.glyphMap =
    tone === "ok" ? "checkmark" : tone === "info" ? "chatbox-outline" : tone === "danger" ? "time-outline" : "alert-circle-outline";
  return (
    <View
      className={boxed ? "flex-row items-center rounded-control pl-3 pr-2 py-2" : "flex-row items-center border-t border-border pt-2.5"}
      style={[{ gap: 8 }, boxed ? { backgroundColor: theme.alpha(tone === "danger" ? "danger" : tone === "ok" ? "success" : "warning", tone === "danger" ? 0.07 : 0.08) } : null]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text className={`text-meta flex-1${boxed ? " font-semibold" : ""}`} style={{ color }}>{text}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          className={boxed ? "rounded-pill border border-border bg-card px-3 justify-center" : ""}
          style={boxed ? { height: 32 } : undefined}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text className="text-meta font-semibold" style={{ color: boxed ? theme.foreground : color }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * What the last balance SMS says against Arth's figure: matches, differs (by how much), or is older
 * than the latest transaction so can't be compared. Null when there is no balance SMS.
 */
export function smsNote(
  account: { last_known_balance?: number | null; last_balance_date?: string | null },
  arthBalance: number,
  stale: boolean,
  who = "bank",
): { tone: NoteTone; text: string } | null {
  if (account.last_known_balance == null) return null;
  const on = account.last_balance_date ? ` · ${shortDate(account.last_balance_date)}` : "";
  if (stale) {
    return { tone: "info", text: `Last SMS ${formatAmount(account.last_known_balance)}${on} · out of date` };
  }
  const gap = Math.abs(account.last_known_balance - arthBalance);
  if (gap < 1) return { tone: "ok", text: `Matches the ${who}'s SMS${on}` };
  return {
    tone: "warn",
    text: `SMS said ${formatAmount(account.last_known_balance)}${account.last_balance_date ? ` on ${shortDate(account.last_balance_date)}` : ""} · ${formatAmount(gap)} apart`,
  };
}

/** "2 closed accounts" with a chevron; the cards follow when open. */
export function ClosedToggle({ count, noun, open, onToggle }: { count: number; noun: { one: string; many: string }; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center mx-4 mt-1 mb-2 px-1"
      style={{ minHeight: 48, gap: 8 }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <Ionicons name="archive-outline" size={16} color={theme.mutedForeground} />
      <Text className="text-meta text-muted-foreground flex-1">
        {count} closed {count === 1 ? noun.one : noun.many}
      </Text>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
    </Pressable>
  );
}

/** A closed account: dimmed tile, its name, a Closed chip. */
export function ClosedAccountRow({ type, title, subtitle, onPress }: { type: string; title: string; subtitle?: string | null; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-2 rounded-card bg-card border border-border px-4 py-3 flex-row items-center"
      style={{ gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, closed`}
    >
      <AccountTypeTile type={type} size={36} radius={10} dim />
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text className="text-body text-muted-foreground" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className="text-label text-muted-foreground" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View className="rounded-pill px-2 py-0.5" style={{ backgroundColor: theme.alpha("danger", 0.08) }}>
        <Text className="text-label font-semibold" style={{ color: theme.danger }}>Closed</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
    </Pressable>
  );
}

/**
 * One mark per month of the financial year: filled when money came in that month, hollow when none
 * did, faint for months still to come (null).
 */
export function MonthStrip({ values, height = 6, label }: { values: (number | null)[]; height?: number; label: string }) {
  const theme = useTheme();
  return (
    <View className="flex-row" style={{ gap: 3 }} accessible accessibilityLabel={label}>
      {values.map((v, i) => (
        <View
          key={i}
          className="flex-1"
          style={{
            height,
            borderRadius: height >= 12 ? 4 : 9999,
            backgroundColor: v == null ? theme.alpha("foreground", 0.04) : v > 0 ? theme.primary : theme.border,
          }}
        />
      ))}
    </View>
  );
}

/**
 * An account's opening for the month, and the balance corrections that also moved it, so opening +
 * in − out + corrections is the balance shown (owner, Nov 2026: the numbers have to add up).
 */
export function OpeningLine({ opening, corrections }: { opening: number; corrections: number }) {
  const theme = useTheme();
  const show = Math.abs(corrections) >= 0.5;
  return (
    <View className="flex-row justify-between" style={{ gap: 8 }}>
      <Text className="text-label text-muted-foreground" numberOfLines={1}>Opened at {formatAmount(opening)}</Text>
      {show && (
        <Text className="text-label" numberOfLines={1} style={{ color: theme.warning }}>
          Corrections {signed(corrections)}
        </Text>
      )}
    </View>
  );
}

/** The uppercase label over the account cards. */
export function CardsLabel({ title }: { title: string }) {
  return (
    <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mx-4 mt-3 mb-2 px-1">{title}</Text>
  );
}
