import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { ac } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";

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
  const { colors, accent, colorScheme } = useColorScheme();
  const alert = useAlert();

  const isRepayment = forecastType === "repayment";

  const handleMarkAsPaid = () => {
    if (isRepayment && onRepaymentPaid) {
      onRepaymentPaid(forecastId);
      return;
    }
    alert(
      "Mark as Paid",
      "This forecast will be dismissed. If a matching transaction exists, it will be linked.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Paid", onPress: () => onMarkAsPaid(forecastId) },
      ],
    );
  };

  const handlePaidExternally = () => {
    alert(
      "Paid Externally",
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
      "Realise Now",
      "Convert this forecast to an actual expense? It will count in your budget from today.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Realise", onPress: () => onRealiseNow(forecastId) },
      ],
    );
  };

  const handleDelete = () => {
    alert(
      "Delete Forecast",
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
    return (
      <View className="flex-row items-center mt-1">
        <Pressable
          onPress={handleMarkAsPaid}
          accessibilityLabel={isRepayment ? "Pay bill" : "Mark as paid"}
          accessibilityRole="button"
          className="flex-row items-center mr-3 py-1"
        >
          <Ionicons name="checkmark-circle-outline" size={14} color={StatusColors[colorScheme].success} />
          <Text className="text-label font-medium text-success ml-0.5">
            {isRepayment ? "Pay" : "Paid"}
          </Text>
        </Pressable>
        {!isRepayment && (
          <Pressable
            onPress={handleRealiseNow}
            accessibilityLabel="Realise now"
            accessibilityRole="button"
            className="flex-row items-center mr-3 py-1"
          >
            <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.blue} />
            <Text className="text-label font-medium ml-0.5" style={{ color: ac(accent, colorScheme, 500, 200) }}>
              Realise
            </Text>
          </Pressable>
        )}
        {onPaidExternally && (
          <Pressable
            onPress={handlePaidExternally}
            accessibilityLabel="Paid externally"
            accessibilityRole="button"
            className="flex-row items-center mr-3 py-1"
          >
            <Ionicons name="exit-outline" size={14} color={colors.textSecondary} />
            <Text className="text-label font-medium ml-0.5" style={{ color: colors.textSecondary }}>
              External
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleDelete}
          accessibilityLabel="Delete forecast"
          accessibilityRole="button"
          className="flex-row items-center py-1"
        >
          <Ionicons name="trash-outline" size={13} color={StatusColors[colorScheme].danger} />
          <Text className="text-label font-medium text-danger ml-0.5">
            Delete
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center justify-around py-2 border-t border-border mt-2">
      <Pressable
        onPress={handleMarkAsPaid}
        accessibilityLabel={isRepayment ? "Pay bill" : "Mark as paid"}
        accessibilityRole="button"
        className="flex-1 items-center py-2"
      >
        <Ionicons name="checkmark-circle-outline" size={20} color={StatusColors[colorScheme].success} />
        <Text className="text-xs font-medium text-success mt-1">
          {isRepayment ? "Pay Bill" : "Mark as Paid"}
        </Text>
      </Pressable>
      <View className="w-px h-8 bg-border" />
      {isRepayment ? (
        <Pressable
          onPress={handlePaidExternally}
          accessibilityLabel="Paid externally"
          accessibilityRole="button"
          className="flex-1 items-center py-2"
        >
          <Ionicons name="exit-outline" size={20} color={colors.textSecondary} />
          <Text className="text-xs font-medium mt-1" style={{ color: colors.textSecondary }}>
            Paid Externally
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={handleRealiseNow}
          accessibilityLabel="Realise now"
          accessibilityRole="button"
          className="flex-1 items-center py-2"
        >
          <Ionicons name="arrow-forward-circle-outline" size={20} color={colors.blue} />
          <Text className="text-xs font-medium mt-1" style={{ color: ac(accent, colorScheme, 500, 200) }}>
            Realise Now
          </Text>
        </Pressable>
      )}
      <View className="w-px h-8 bg-border" />
      <Pressable
        onPress={handleDelete}
        accessibilityLabel="Delete forecast"
        accessibilityRole="button"
        className="flex-1 items-center py-2"
      >
        <Ionicons name="trash-outline" size={20} color={StatusColors[colorScheme].danger} />
        <Text className="text-xs font-medium text-danger mt-1">
          Delete
        </Text>
      </Pressable>
    </View>
  );
}
