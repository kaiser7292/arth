import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatExactAmount } from "@/utils/format";
import { Chip, type ChipTone } from "./Chip";
import { moneyTone } from "./money-tone";
import { Text } from "./Text";

export interface TransactionRowStatus {
  label: string;
  tone?: ChipTone;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

export interface TransactionRowProps {
  /** To the last paisa even with Settings → Region → Decimals on Round off (account ledgers). */
  exact?: boolean;
  /** The tile's icon and colour: the category, a credit's type, a transfer. */
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  amount: number;
  /** out: red. in: green with a plus. moved: a transfer, purple. */
  flow: "out" | "in" | "moved";
  /** A plus on a transfer that came in. */
  plus?: boolean;
  /** Overrides the amount's colour and sign where a ledger means something else (Hisaab). */
  amountColor?: string;
  sign?: "+" | "−" | "";
  /** The category chip on line 2. */
  chip?: { label: string; color: string } | null;
  /** Merchant · account · card, after the chip. */
  meta?: string | null;
  /** The one status the row shows. */
  status?: TransactionRowStatus | null;
  /** Right of line 2. */
  date?: string | null;
  /** Line 3: a split, the counter-account. */
  note?: string | null;
  /** Line 3, right: the running balance after this row. */
  after?: string | null;
  /** Inside a card: no bottom rule, a top rule between rows. */
  inCard?: boolean;
  divider?: boolean;
  highlighted?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * One transaction, drawn the way the Transactions tab draws it (ExpenseListItem): a tinted icon
 * tile, the name and the amount on line 1, the category chip, what else to know and the date on
 * line 2. Ledgers use it so every list of transactions in the app reads the same (owner, Nov 2026).
 */
export function TransactionRow({
  icon,
  color,
  title,
  amount,
  flow,
  plus,
  amountColor,
  sign,
  chip,
  meta,
  status,
  date,
  note,
  after,
  inCard = false,
  divider = false,
  highlighted = false,
  onPress,
  onLongPress,
  onLayout,
  accessibilityLabel,
  accessibilityHint,
  exact,
}: TransactionRowProps) {
  const money = exact ? formatExactAmount : formatAmount;
  const theme = useTheme();
  const fg = amountColor ?? (flow === "out" ? theme.danger : moneyTone(theme, flow).fg);
  const shownSign = sign ?? (flow === "in" || (flow === "moved" && plus) ? "+" : "");
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayout}
      disabled={!onPress && !onLongPress}
      className={`flex-row items-start ${inCard ? "px-3.5" : "px-4"} py-3 ${inCard ? (divider ? "border-t border-border" : "") : "border-b border-border"}`}
      style={highlighted ? { backgroundColor: theme.alpha("primary", 0.12), borderLeftWidth: 3, borderLeftColor: theme.primary } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? `${title}, ${shownSign}${money(amount)}${date ? `, ${date}` : ""}`}
      accessibilityHint={accessibilityHint}
    >
      <View className="w-10 h-10 rounded-control items-center justify-center mr-3" style={{ backgroundColor: tint(color, 0.12) }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>

      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center">
          <Text className="flex-1 text-body font-semibold text-foreground mr-3" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-body font-bold shrink-0" style={{ color: fg, fontVariant: ["tabular-nums"] }}>
            {shownSign}
            {money(amount)}
          </Text>
        </View>

        <View className="flex-row items-center mt-1" style={{ gap: 8 }}>
          <View className="flex-1 flex-row items-center" style={{ gap: 6, minWidth: 0 }}>
            {chip ? <Chip variant="category" label={chip.label} color={chip.color} /> : null}
            {meta ? (
              <Text className="text-meta text-muted-foreground shrink" numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
            {status ? <Chip variant="status" tone={status.tone ?? "neutral"} label={status.label} icon={status.icon} onPress={status.onPress} /> : null}
          </View>
          {date ? (
            <Text className="text-label text-muted-foreground shrink-0" numberOfLines={1}>
              {date}
            </Text>
          ) : null}
        </View>

        {note || after ? (
          <View className="flex-row items-center mt-1" style={{ gap: 8 }}>
            <Text className="flex-1 text-meta text-muted-foreground" numberOfLines={1}>
              {note ?? ""}
            </Text>
            {after ? (
              <Text className="text-label text-faint-foreground shrink-0" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
                {after}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
