import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { getBucketsByFY } from "@/services/yearly-plan";
import type { InvestmentBucket } from "@/services/yearly-plan";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import type { DematTarget } from "@/services/demat-transfer";

/**
 * Follow-up sheet shown after a transfer *lands* in a demat account. Lets the
 * user declare whether the money is idle "fund" or was already invested into
 * the "portfolio", and optionally link it to an active investment bucket so
 * yearly-plan progress and linked milestones reflect the contribution.
 *
 * The sheet is *composed* after the transfer is already created — it doesn't
 * create the transfer itself. On confirm it invokes `onConfirm` with the
 * chosen target and optional bucket id; on skip, no side-effects are applied
 * and the transfer remains in the ledger with demat_target = NULL.
 */

interface DematTransferTargetSheetProps {
  visible: boolean;
  dematAccountLabel: string;
  amount: number;
  /** Transfer date in YYYY-MM-DD; used to scope the bucket picker to the right FY. */
  date: string;
  onConfirm: (target: DematTarget, bucketId: string | null) => void;
  onClose: () => void;
}

export function DematTransferTargetSheet({
  visible,
  dematAccountLabel,
  amount,
  date,
  onConfirm,
  onClose,
}: DematTransferTargetSheetProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [target, setTarget] = useState<DematTarget>("fund");
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [bucketId, setBucketId] = useState<string | null>(null);
  const slideAnim = useSharedValue(400);

  // Load buckets for the FY of the transfer date — users typically record
  // contributions against the current-year plan, and showing unrelated years
  // would be noise.
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const startMonth = getFYStartMonth();
        const fy = getCurrentFY(startMonth, new Date(date));
        const rows = await getBucketsByFY(DEFAULT_USER_ID, String(fy));
        setBuckets(rows);
      } catch {
        setBuckets([]);
      }
    })();
  }, [visible, date]);

  useEffect(() => {
    if (visible) {
      setTarget("fund");
      setBucketId(null);
      slideAnim.value = withTiming(0, { duration: 250 });
    }
  }, [visible, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handleConfirm = useCallback(() => {
    const chosenTarget = target;
    const chosenBucket = bucketId;
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onConfirm)(chosenTarget, chosenBucket);
    });
  }, [slideAnim, onConfirm, target, bucketId]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  if (!visible) return null;

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
          { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
        ]}
        className="pb-8"
      >
        {/* Drag handle */}
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>

        {/* Header */}
        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            Going into {dematAccountLabel}
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
            {formatAmount(amount)} on {date}
          </Text>
        </View>

        {/* Fund vs Portfolio — primary choice, visually heavier than the
            optional bucket picker below. Solid border + higher-alpha tint
            when active; matches the DS while giving each tile a clear "seat". */}
        <View className="px-5 pt-1 pb-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: colors.textSecondary }}
          >
            This money is
          </Text>
          {[
            {
              key: "fund" as const,
              label: "Idle cash (Fund)",
              sub: "Sitting with the broker, not yet invested",
              icon: "wallet-outline" as const,
            },
            {
              key: "portfolio" as const,
              label: "Already invested (Portfolio)",
              sub: "Already bought stocks/MFs on this date",
              icon: "trending-up-outline" as const,
            },
          ].map((opt) => {
            const active = target === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setTarget(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className="flex-row items-center py-3.5 px-4 rounded-xl mb-2.5"
                style={{
                  backgroundColor: active
                    ? ac(accent, colorScheme, 500, 300) + "26"
                    : colors.surface === colors.background
                      ? undefined
                      : colors.surface,
                  borderWidth: active ? 2 : 1,
                  borderColor: active
                    ? ac(accent, colorScheme, 500, 300)
                    : colors.border,
                }}
              >
                <Ionicons
                  name={opt.icon}
                  size={22}
                  color={active ? ac(accent, colorScheme, 600, 200) : colors.textSecondary}
                />
                <View className="flex-1 ml-3">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.text }}
                  >
                    {opt.label}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                    {opt.sub}
                  </Text>
                </View>
                {active && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={ac(accent, colorScheme, 600, 200)}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Bucket picker (only if there are active buckets for this FY).
            Lighter visual weight than Fund/Portfolio above — rows, not tiles. */}
        {buckets.length > 0 && (
          <View className="px-5 pt-1 pb-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Link to investment bucket (optional)
            </Text>

            {/* "Don't link" — lives outside the list; selection chip not tile. */}
            <Pressable
              onPress={() => setBucketId(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: bucketId === null }}
              className="flex-row items-center py-2 px-2 rounded-md"
              style={{
                backgroundColor:
                  bucketId === null ? ac(accent, colorScheme, 500, 300) + "1A" : "transparent",
              }}
            >
              <Ionicons
                name="close-circle-outline"
                size={16}
                color={bucketId === null ? ac(accent, colorScheme, 600, 200) : colors.textSecondary}
              />
              <Text
                className="flex-1 ml-2 text-sm"
                style={{
                  color: colors.text,
                  fontWeight: bucketId === null ? "600" : "400",
                }}
              >
                Don't link
              </Text>
              {bucketId === null && (
                <Ionicons
                  name="checkmark"
                  size={16}
                  color={ac(accent, colorScheme, 600, 200)}
                />
              )}
            </Pressable>

            <FlatList
              data={buckets}
              keyExtractor={(item) => item.id}
              scrollEnabled
              style={{ maxHeight: 180 }}
              renderItem={({ item }) => {
                const active = bucketId === item.id;
                return (
                  <Pressable
                    onPress={() => setBucketId(item.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className="flex-row items-center py-2 px-2 rounded-md"
                    style={{
                      backgroundColor: active
                        ? ac(accent, colorScheme, 500, 300) + "1A"
                        : "transparent",
                    }}
                  >
                    <Ionicons
                      name="bookmark-outline"
                      size={16}
                      color={active ? ac(accent, colorScheme, 600, 200) : colors.textSecondary}
                    />
                    <Text
                      className="flex-1 ml-2 text-sm"
                      style={{
                        color: colors.text,
                        fontWeight: active ? "600" : "400",
                      }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.textSecondary }}>
                      {formatAmount(item.current_contributed)} / {formatAmount(item.annual_target)}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        )}

        {/* Actions.
            - "Skip for now" — the transfer itself is already saved; skipping
              just means demat_target stays NULL and nothing hits the snapshot
              tables or bucket. Labeled to make that clear.
            - "Apply" — applies the side-effects (snapshot bump + optional
              bucket contribution). Not "Save" because the row already exists. */}
        <View className="flex-row px-5 pt-3 gap-3">
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            accessibilityHint="The transfer is saved but fund/portfolio is not set. You can categorize it later."
            className="flex-1 py-3 rounded-xl items-center"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
              Skip for now
            </Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel="Apply"
            className="flex-1 py-3 rounded-xl items-center"
            style={{ backgroundColor: accent[500] }}
          >
            <Text className="text-sm font-semibold text-white">Apply</Text>
          </Pressable>
        </View>

        {/* Sub-hint under actions — tells the user Skip isn't destructive. */}
        <Text
          className="text-[11px] text-center mt-2 px-5"
          style={{ color: colors.textSecondary }}
        >
          Skip leaves the transfer uncategorized - you can edit it later.
        </Text>
      </Animated.View>
    </Modal>
  );
}
