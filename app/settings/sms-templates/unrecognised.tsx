import { useCallback, useMemo, useState } from "react";
import { View, FlatList, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LoadingState, ScreenContainer, Text } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  listUnrecognisedSms,
  type UnrecognisedSmsRow,
} from "@/services/sms/user-sms-templates";
import { useTheme } from "@/hooks/use-theme";

/**
 * v15.6.0 — Browser for pending_sms rows that never became expenses.
 *
 * Shows last 30 days of SMS where status IN ('pending', 'failed') AND
 * expense_id IS NULL. Each row has a "Teach this" button that navigates to
 * the paste screen with the body pre-filled.
 *
 * New in v15.6.0:
 *   - Search field filters by body OR sender address (case-insensitive).
 *   - "Group similar" toggle collapses look-alike SMS (same sender + same
 *     digit-normalized body prefix) into a single row with a count. Taps
 *     teach the first row of the group; the rest match the same template
 *     automatically.
 */
export default function UnrecognisedSmsScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [rows, setRows] = useState<UnrecognisedSmsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await listUnrecognisedSms(200);
      setRows(data);
    } catch (e) {
      alert(
        "Couldn't load SMS",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const handleTeach = useCallback(
    (row: UnrecognisedSmsRow) => {
      router.push({
        pathname: "/settings/sms-templates/new",
        params: {
          prefilledBody: row.body,
          smsId: row.id,
          senderAddress: row.address,
        },
      } as never);
    },
    [router],
  );

  const formatDate = useCallback((ms: number): string => {
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }, []);

  /** Canonicalize the body so near-duplicates group together. */
  const canonicalKey = useCallback((body: string): string => {
    return body
      .replace(/\d/g, "#")      // normalise amounts, dates, refs
      .replace(/[A-Za-z]{8,}/g, "W") // long words become a placeholder (merchant names)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 60);
  }, []);

  // Apply query filter + optional grouping.
  const displayRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = rows;
    if (q.length > 0) {
      filtered = rows.filter(
        (r) =>
          r.body.toLowerCase().includes(q) ||
          r.address.toLowerCase().includes(q),
      );
    }
    if (!grouped) {
      return filtered.map((r) => ({ row: r, count: 1 }));
    }
    const groups = new Map<string, { row: UnrecognisedSmsRow; count: number }>();
    for (const r of filtered) {
      const key = `${r.address}|${canonicalKey(r.body)}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        // Keep the newest row as representative
        if (r.sms_date > existing.row.sms_date) existing.row = r;
      } else {
        groups.set(key, { row: r, count: 1 });
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => b.row.sms_date - a.row.sms_date,
    );
  }, [rows, query, grouped, canonicalKey]);

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2">
          <Text className="text-xs text-faint-foreground">
            Bank SMS from the last 30 days that Arth couldn't read. Tap "Teach" to build a template.
          </Text>
        </View>

        <View className="px-4 pb-3">
          <View
            className="flex-row items-center rounded-lg"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 10,
            }}
          >
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search sender or text…"
              placeholderTextColor={colors.textSecondary}
              style={{
                flex: 1,
                paddingVertical: 8,
                paddingHorizontal: 8,
                fontSize: 14,
                color: colors.text,
              }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setGrouped(!grouped)}
            className="flex-row items-center mt-2.5"
          >
            <Ionicons
              name={grouped ? "checkbox" : "square-outline"}
              size={16}
              color={grouped ? accentColor : colors.textSecondary}
            />
            <Text
              className="text-xs ml-1.5"
              style={{ color: grouped ? accentColor : colors.textSecondary }}
            >
              Group similar SMS (same sender + pattern)
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <LoadingState />
        ) : (
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            data={displayRows}
            keyExtractor={(item) => item.row.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Card className="mb-3">
                <View className="flex-row items-center mb-1">
                  <Ionicons
                    name="mail-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text className="text-xs font-semibold ml-2 text-muted-foreground">
                    {item.row.address}
                  </Text>
                  {item.count > 1 && (
                    <View
                      className="ml-2 px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: accentColor + "18" }}
                    >
                      <Text className="text-label font-bold" style={{ color: accentColor }}>
                        ×{item.count}
                      </Text>
                    </View>
                  )}
                  <Text className="text-xs text-faint-foreground ml-auto">
                    {formatDate(item.row.sms_date)}
                  </Text>
                </View>
                <Text
                  className="text-sm text-foreground my-2"
                  numberOfLines={3}
                >
                  {item.row.body}
                </Text>
                <Pressable
                  onPress={() => handleTeach(item.row)}
                  className="flex-row items-center justify-center py-2 rounded-lg"
                  style={{ backgroundColor: accentColor + "15" }}
                >
                  <Ionicons name="construct-outline" size={16} color={accentColor} />
                  <Text
                    className="text-sm font-semibold ml-2"
                    style={{ color: accentColor }}
                  >
                    {item.count > 1
                      ? `Teach Arth (${item.count} similar SMS)`
                      : "Teach Arth to read this"}
                  </Text>
                </Pressable>
              </Card>
            )}
            ListEmptyComponent={
              <View className="items-center justify-center mt-16 px-8">
                <Ionicons
                  name={query ? "search-outline" : "checkmark-done-circle-outline"}
                  size={48}
                  color={colors.textSecondary}
                />
                <Text className="text-lg font-medium text-foreground mt-4">
                  {query ? "No matches" : "All SMS were recognised"}
                </Text>
                <Text className="text-sm text-faint-foreground text-center mt-2">
                  {query
                    ? "Try a different search term, or clear the search."
                    : "Every bank SMS from the last 30 days either became an expense or was intentionally skipped (OTPs, balance enquiries)."}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
  );
}
