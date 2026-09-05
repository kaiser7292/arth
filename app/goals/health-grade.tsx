import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { ac } from "@/utils/accent";
import type { HealthGrade, HealthFactor } from "@/utils/financial-cockpit";

const GRADE_RANGES: [HealthGrade, string, string][] = [
  ["A+", "90–100", "Excellent"],
  ["A",  "80–89",  "Great"],
  ["B",  "70–79",  "Good"],
  ["C",  "55–69",  "Needs attention"],
  ["D",  "40–54",  "Critical"],
  ["F",  "0–39",   "Off-plan"],
];

const GRADE_DESC: Record<HealthGrade, string> = {
  "A+": "Excellent — your plan is firing on all cylinders",
  "A":  "Great — strong across the board with only minor gaps",
  "B":  "Good — solid foundation with a few areas to improve",
  "C":  "Needs attention — material gaps in one or more areas",
  "D":  "Critical — significant gaps, act now to avoid shortfalls",
  "F":  "Off-plan — major correction needed urgently",
};

const NEXT_GRADE: Partial<Record<HealthGrade, HealthGrade>> = {
  "F": "D", "D": "C", "C": "B", "B": "A", "A": "A+",
};

const FACTOR_TIPS: Record<string, string> = {
  "Savings":     "Increase your savings rate towards your target",
  "Investments": "Catch up on investment contributions this FY",
  "Spending":    "Bring spending within your monthly budget",
  "Goals":       "Make consistent progress on milestones and buckets",
  "Surplus":     "Free up monthly headroom by trimming fixed commitments",
};

export default function HealthGradeScreen() {
  const { grade, score, factorsJson } = useLocalSearchParams<{
    grade: string;
    score: string;
    factorsJson: string;
  }>();
  const { colors, accent, colorScheme } = useColorScheme();
  const accentColor = ac(accent, colorScheme, 500, 400);

  const healthGrade = (grade ?? "B") as HealthGrade;
  const healthScore = parseFloat(score ?? "0");
  let factors: HealthFactor[] = [];
  try { factors = JSON.parse(factorsJson ?? "[]"); } catch { /* ignore */ }

  const isGood = healthGrade === "A+" || healthGrade === "A";
  const isOK   = healthGrade === "B";
  const isWarn = healthGrade === "C";

  const mainColor = isGood
    ? StatusColors[colorScheme].success
    : isOK
      ? accentColor
      : isWarn
        ? StatusColors[colorScheme].warning
        : StatusColors[colorScheme].danger;

  const mainBg = isGood
    ? StatusColors[colorScheme].successBg
    : isOK
      ? accentColor + "14"
      : isWarn
        ? StatusColors[colorScheme].warningBg
        : StatusColors[colorScheme].dangerBg;

  const nextG = NEXT_GRADE[healthGrade];
  const weakFactors = [...factors]
    .filter((f) => f.status !== "positive")
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .slice(0, 2);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 py-4">

          {/* Grade hero */}
          <Card className="mb-4">
            <View className="flex-row items-start justify-between mb-4">
              <View className="flex-1 pr-4">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Financial Health Grade
                </Text>
                <Text className="text-5xl font-bold mb-1" style={{ color: mainColor }}>
                  {healthGrade}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {GRADE_DESC[healthGrade]}
                </Text>
              </View>
              <View
                className="w-16 h-16 rounded-full items-center justify-center shrink-0"
                style={{ borderWidth: 2.5, borderColor: mainColor + "60", backgroundColor: mainBg }}
              >
                <Text className="text-lg font-bold" style={{ color: mainColor }}>
                  {Math.round(healthScore)}
                </Text>
                <Text className="text-label text-faint-foreground">/ 100</Text>
              </View>
            </View>

            {/* Score bar */}
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs text-faint-foreground">Score</Text>
              <Text className="text-xs font-semibold" style={{ color: mainColor }}>
                {Math.round(healthScore)} / 100
              </Text>
            </View>
            <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
              <View
                className="h-full rounded-full"
                style={{ width: `${healthScore}%`, backgroundColor: mainColor }}
              />
            </View>
          </Card>

          {/* Factors breakdown */}
          {factors.length > 0 && (
            <Card className="mb-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                What's driving this grade
              </Text>
              {factors.map((f, i) => {
                const fColor = f.status === "positive"
                  ? StatusColors[colorScheme].success
                  : f.status === "neutral"
                    ? colors.textSecondary
                    : StatusColors[colorScheme].warning;
                return (
                  <View
                    key={f.name}
                    className={`py-3${i < factors.length - 1 ? " border-b border-border" : ""}`}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-2">
                        <Ionicons
                          name={
                            f.status === "positive"
                              ? "checkmark-circle"
                              : f.status === "neutral"
                                ? "remove-circle-outline"
                                : "alert-circle"
                          }
                          size={15}
                          color={fColor}
                        />
                        <Text className="text-sm font-medium text-foreground">
                          {f.name}
                        </Text>
                        <Text className="text-label text-faint-foreground">
                          {Math.round(f.weight * 100)}% wt
                        </Text>
                      </View>
                      <Text className="text-xs font-semibold" style={{ color: fColor }}>
                        {Math.round(f.score)}/100
                      </Text>
                    </View>
                    <View className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ backgroundColor: colors.border }}>
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(2, f.score)}%`, backgroundColor: fColor }}
                      />
                    </View>
                    <Text className="text-label text-faint-foreground">{f.detail}</Text>
                  </View>
                );
              })}
            </Card>
          )}

          {/* Tips to reach next grade */}
          {nextG && weakFactors.length > 0 && (
            <Card className="mb-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                To reach Grade {nextG}
              </Text>
              {weakFactors.map((f, i) => (
                <View
                  key={f.name}
                  className={`flex-row items-start gap-2${i > 0 ? " mt-2.5" : ""}`}
                >
                  <Ionicons
                    name="arrow-forward-circle-outline"
                    size={15}
                    color={accentColor}
                    style={{ marginTop: 1 }}
                  />
                  <Text className="text-sm text-foreground flex-1">
                    {FACTOR_TIPS[f.name] ?? "Improve this area"}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {/* Grade scale reference */}
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Grade scale
            </Text>
            {GRADE_RANGES.map(([g, range, label]) => {
              const isCurrent = g === healthGrade;
              return (
                <View
                  key={g}
                  className="flex-row items-center py-2 rounded-lg"
                  style={isCurrent ? { backgroundColor: mainBg, paddingHorizontal: 8, marginHorizontal: -8 } : {}}
                >
                  <Text
                    className="text-sm font-bold w-8"
                    style={{ color: isCurrent ? mainColor : colors.textSecondary }}
                  >
                    {g}
                  </Text>
                  <Text className="text-xs text-faint-foreground w-16">{range}</Text>
                  <Text
                    className={`text-xs flex-1 ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {label}
                  </Text>
                  {isCurrent && (
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: mainColor }} />
                  )}
                </View>
              );
            })}
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
