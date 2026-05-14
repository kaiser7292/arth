import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import {
  getAllActiveBuckets,
  type InvestmentBucket,
} from "@/services/yearly-plan";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";

/**
 * Investment Bucket picker for "Mark expense as investment" (v17.0.0).
 *
 * Shows all active buckets across all FYs, current-FY first (no divider — sort
 * handles ordering). Each row: bucket name, FY, progress bar with current/target.
 */

interface Props {
  visible: boolean;
  expenseAmount: number;
  onPick: (bucketId: string) => void;
  onClose: () => void;
}

export function InvestmentBucketPickerSheet({
  visible,
  expenseAmount,
  onPick,
  onClose,
}: Props) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFY, setCurrentFY] = useState<string>("");
  const slideAnim = useSharedValue(400);

  useEffect(() => {
    if (!visible) return;
    slideAnim.value = withTiming(0, { duration: 250 });
    (async () => {
      setLoading(true);
      try {
        const startMonth = getFYStartMonth();
        const fy = String(getCurrentFY(startMonth));
        setCurrentFY(fy);
        const list = await getAllActiveBuckets(DEFAULT_USER_ID);
        // Current-FY first, then others
        list.sort((a, b) => {
          const aCur = a.financial_year === fy ? 1 : 0;
          const bCur = b.financial_year === fy ? 1 : 0;
          if (aCur !== bCur) return bCur - aCur;
          return (b.financial_year ?? "").localeCompare(a.financial_year ?? "");
        });
        setBuckets(list);
      } catch {
        setBuckets([]);
      }
      setLoading(false);
    })();
  }, [visible, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handlePick = useCallback(
    (bucketId: string) => {
      slideAnim.value = withTiming(400, { duration: 200 }, () => {
        runOnJS(onPick)(bucketId);
      });
    },
    [slideAnim, onPick],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  if (!visible) return null;

  const startMonth = getFYStartMonth();

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <Animated.View
        style={[
          animStyle,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "85%",
          },
        ]}
        className="pb-8"
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>

        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            Mark as investment
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
            Pick a bucket to credit this {formatAmount(expenseAmount)}. It won't count toward
            your budget; it counts toward your bucket goal.
          </Text>
        </View>

        {loading ? (
          <View className="px-5 py-8 items-center">
            <Text className="text-sm" style={{ color: colors.textSecondary }}>
              Loading buckets…
            </Text>
          </View>
        ) : buckets.length === 0 ? (
          <View className="px-5 py-8 items-center">
            <Ionicons name="wallet-outline" size={40} color={colors.textSecondary} />
            <Text className="text-sm mt-3 text-center" style={{ color: colors.textSecondary }}>
              No active investment buckets. Create one from the Goals tab → Investment buckets.
            </Text>
          </View>
        ) : (
          <ScrollView
            className="px-5"
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {buckets.map((b) => {
              const fyNum = parseInt(b.financial_year ?? "0", 10);
              const fyLabel = fyNum > 0 ? getFYLabel(fyNum, startMonth) : "No FY";
              const isCurrent = b.financial_year === currentFY;
              const progress =
                b.annual_target > 0
                  ? Math.min(100, (b.current_contributed / b.annual_target) * 100)
                  : 0;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => handlePick(b.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Credit ${b.name} bucket. ${formatAmount(b.current_contributed)} of ${formatAmount(b.annual_target)} so far.`}
                  className="py-3 px-4 rounded-xl mb-2"
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View className="flex-row items-center mb-2">
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}
                    >
                      <Ionicons
                        name="trending-up-outline"
                        size={18}
                        color={ac(accent, colorScheme, 600, 200)}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: colors.text }}
                      >
                        {b.name}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        {fyLabel}
                        {isCurrent ? " · Current FY" : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </View>
                  {b.annual_target > 0 && (
                    <>
                      <View
                        style={{
                          height: 4,
                          backgroundColor: colors.border,
                          borderRadius: 2,
                          overflow: "hidden",
                          marginTop: 4,
                        }}
                      >
                        <View
                          style={{
                            height: 4,
                            width: `${progress}%`,
                            backgroundColor: ac(accent, colorScheme, 500, 400),
                          }}
                        />
                      </View>
                      <Text className="text-xs mt-1" style={{ color: colors.textSecondary }}>
                        {formatAmount(b.current_contributed)} of {formatAmount(b.annual_target)} ({progress.toFixed(0)}%)
                      </Text>
                    </>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View className="px-5 pt-3">
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="py-3 rounded-xl items-center"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}
