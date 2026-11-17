import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAlert } from "@/hooks/use-alert";


import { useTheme } from "@/hooks/use-theme";

interface ForecastActionBarProps {
  forecastId: string;
  forecastType?: "expense" | "repayment";
  compact?: boolean;
  onMarkAsPaid: (id: string) => void;
  onRealiseNow: (id: string) => void;
  onDelete: (id: string) => void;
  onRepaymentPaid?: (id: string) => void;
  onPaidExternally?: (id: string) => void;
}

export function ForecastActionBar({
  forecastId,
  forecastType = "expense",
  compact = false,
  onMarkAsPaid,
  onRealiseNow,
  onDelete,
  onRepaymentPaid,
  onPaidExternally,
}: ForecastActionBarProps) {
  const theme = useTheme();
  const alert = useAlert();

  const isRepayment = forecastType === "repayment";

  const handleMarkAsPaid = () => {
    if (isRepayment && onRepaymentPaid) {
      onRepaymentPaid(forecastId);
      return;
    }
    alert(
      "Mark as paid",
      "This forecast will be dismissed. If a matching transaction exists, it will be linked.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark paid", onPress: () => onMarkAsPaid(forecastId) },
      ],
    );
  };

  const handlePaidExternally = () => {
    alert(
      "Paid externally",
      isRepayment
        ? "CC dues will be reduced, but no savings account will be debited."
        : "This forecast will be dismissed without any balance changes.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => onPaidExternally?.(forecastId) },
      ],
    );
  };

  const handleRealiseNow = () => {
    alert(
      "Realise now",
      "Convert this forecast to an actual expense? It will count in your budget from today.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Realise", onPress: () => onRealiseNow(forecastId) },
      ],
    );
  };

  const handleDelete = () => {
    alert(
      "Delete forecast",
      "Remove this forecast? It will no longer appear in upcoming dues.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => onDelete(forecastId),
        },
      ],
    );
  };

  if (compact) {
    // Home's Upcoming Dues rows: the same small rounded buttons as the Reminders card above it,
    // with Delete kept on the row as a quiet icon button (the confirm dialog carries the red).
    const pill = "px-3 py-1.5 rounded-pill";
    return (
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Pressable
          onPress={handleMarkAsPaid}
          accessibilityLabel={isRepayment ? "Pay bill" : "Mark as paid"}
          accessibilityRole="button"
          className={pill}
          style={{ backgroundColor: theme.primary }}
        >
          <Text className="text-label font-semibold text-primary-foreground">
            {isRepayment ? "Pay" : "Paid"}
          </Text>
        </Pressable>
        {!isRepayment && (
          <Pressable
            onPress={handleRealiseNow}
            accessibilityLabel="Realise now"
            accessibilityRole="button"
            className={`${pill} border`}
            style={{ borderColor: theme.border }}
          >
            <Text className="text-label font-semibold text-muted-foreground">Realise</Text>
          </Pressable>
        )}
        {onPaidExternally && (
          <Pressable
            onPress={handlePaidExternally}
            accessibilityLabel="Paid externally"
            accessibilityRole="button"
            className={`${pill} border`}
            style={{ borderColor: theme.border }}
          >
            <Text className="text-label font-semibold text-muted-foreground">
              {isRepayment ? "Paid elsewhere" : "Elsewhere"}
            </Text>
          </Pressable>
        )}
        <View className="flex-1" />
        <Pressable
          onPress={handleDelete}
          accessibilityLabel="Delete forecast"
          accessibilityRole="button"
          hitSlop={6}
          className="w-8 h-8 rounded-pill items-center justify-center"
        >
          <Ionicons name="trash-outline" size={16} color={theme.mutedForeground} />
        </Pressable>
      </View>
    );
  }

  // The full bar (a forecast's detail page): pill buttons, the same as a linked card's actions.
  const pill = (label: string, onPress: () => void, kind: "primary" | "plain" | "danger", icon: keyof typeof Ionicons.glyphMap) => {
    const fg = kind === "primary" ? theme.primaryForeground : kind === "danger" ? theme.danger : theme.primary;
    return (
      <Pressable
        key={label}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
        className={`flex-row items-center justify-center rounded-pill px-4 ${kind === "primary" ? "" : "border"}`}
        style={{ minHeight: 40, backgroundColor: kind === "primary" ? theme.primary : theme.card, borderColor: kind === "danger" ? theme.danger : theme.border }}
      >
        <Ionicons name={icon} size={16} color={fg} style={{ marginRight: 6 }} />
        <Text className="text-meta font-semibold" style={{ color: fg }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View className="flex-row flex-wrap px-4 pb-4 pt-1" style={{ gap: 8 }}>
      {pill(isRepayment ? "Pay bill" : "Mark as paid", handleMarkAsPaid, "primary", "checkmark-circle-outline")}
      {isRepayment
        ? pill("Paid elsewhere", handlePaidExternally, "plain", "exit-outline")
        : pill("Realise now", handleRealiseNow, "plain", "arrow-forward-circle-outline")}
      {pill("Delete", handleDelete, "danger", "trash-outline")}
    </View>
  );
}
