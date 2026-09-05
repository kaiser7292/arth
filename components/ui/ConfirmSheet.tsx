import { Pressable, Text, View } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  context?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  context,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmSheetProps) {
  const { colors, accent } = useColorScheme();

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightPct={45}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Text className="text-lg font-bold text-foreground mb-1">
          {title}
        </Text>
        {context ? (
          <Text className="text-sm font-semibold text-muted-foreground mb-1">
            {context}
          </Text>
        ) : null}
        {message ? (
          <Text className="text-sm text-muted-foreground mb-5">
            {message}
          </Text>
        ) : <View className="mb-5" />}
        <View className="flex-row gap-3">
          <Pressable
            onPress={onClose}
            className="flex-1 py-3.5 rounded-2xl items-center"
            style={{ backgroundColor: colors.border + "66" }}
          >
            <Text className="text-base font-semibold text-foreground">
              {cancelLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            className="flex-1 py-3.5 rounded-2xl items-center"
            style={{ backgroundColor: destructive ? "#EF4444" : accent[500] }}
          >
            <Text className="text-base font-semibold text-white">
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
