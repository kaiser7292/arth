import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ScreenContainer, Card, Button, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { useAlert } from "@/hooks/use-alert";
import {
  parseScheduleCsv,
  applyScheduleCsv,
  revertToGeneratedSchedule,
  type ParsedScheduleRow,
} from "@/services/loan-schedule-import";
import {
  getLoanById,
  getSchedule,
  regenerateScheduleFromParams,
  type LoanAccount,
} from "@/services/loan-accounts";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { acAlpha } from "@/utils/accent";
import { formatError } from "@/utils/error-message";

/**
 * Loan schedule import screen (v17.6.0, Change 4).
 *
 * Lets the user upload a CSV of their bank's authoritative amortization
 * schedule and apply it as the loan's schedule. Useful when Arth's
 * formula can't match the bank's exact numbers.
 */
export default function ImportScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();

  const [loan, setLoan] = useState<LoanAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedScheduleRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  // Load the loan so we can display bank name + currency on the preview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setLoaded(true);
        return;
      }
      const l = await getLoanById(id);
      if (cancelled) return;
      setLoan(l);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const formatMoney = useCallback(
    (n: number) =>
      loan && loan.currency !== "INR"
        ? `${loan.currency} ${n.toLocaleString()}`
        : formatAmount(n),
    [loan],
  );

  const handlePick = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const file = new File(asset.uri);
      const text = await file.text();
      const { rows: parsed, errors: parseErrors } = parseScheduleCsv(text);
      setRows(parsed);
      setErrors(parseErrors);
      setFileName(asset.name);
    } catch (e) {
      alert("Couldn't read file", formatError("Read CSV", e));
    }
  }, [alert]);

  const handleApply = useCallback(async () => {
    if (!id || rows.length === 0) return;
    alert(
      "Replace existing schedule?",
      "This will overwrite Arth's computed amortization schedule with your CSV.\n\nAny prepayments and manual corrections you've recorded for this loan will be cleared — your CSV becomes the single source of truth for the schedule.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          style: "destructive",
          onPress: async () => {
            setApplying(true);
            try {
              await applyScheduleCsv(id, rows);
              router.replace({ pathname: "/loans/[id]", params: { id } } as never);
            } catch (e) {
              alert("Couldn't apply schedule", formatError("Apply CSV", e));
              setApplying(false);
            }
          },
        },
      ],
    );
  }, [alert, id, rows, router]);

  const handleRevert = useCallback(async () => {
    if (!id || !loan) return;
    alert(
      "Go back to calculated schedule?",
      "Arth will regenerate the amortization schedule using your loan's rate, tenure, and EMI. Your imported schedule will be lost, but prepayments and corrections will come back.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert",
          style: "destructive",
          onPress: async () => {
            setApplying(true);
            try {
              // Flip schedule_source back to 'generated' THEN regenerate —
              // order matters: regenerate short-circuits on manual_csv.
              await revertToGeneratedSchedule(id);
              await regenerateScheduleFromParams(id);
              router.replace({ pathname: "/loans/[id]", params: { id } } as never);
            } catch (e) {
              alert("Couldn't revert", formatError("Revert schedule", e));
              setApplying(false);
            }
          },
        },
      ],
    );
  }, [alert, id, loan, router]);

  const handleDownloadTemplate = useCallback(async () => {
    if (!id) return;
    try {
      const schedule = await getSchedule(id);
      if (schedule.length === 0) {
        alert(
          "No schedule yet",
          "Save the loan first so Arth can compute a starter schedule. Then come back here and download the template.",
        );
        return;
      }
      const lines = [
        "installment_num,due_date,opening_principal,emi_amount,principal_component,interest_component,closing_principal",
      ];
      for (const e of schedule) {
        lines.push(
          [
            e.installment_num,
            e.due_date,
            e.opening_principal,
            e.emi_amount,
            e.principal_component,
            e.interest_component,
            e.closing_principal,
          ].join(","),
        );
      }
      const text = lines.join("\n") + "\n";
      const path = `${globalThis.Blob ? "" : ""}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FileSystemMod: any = await import("expo-file-system");
      const cachePath = `${FileSystemMod.Paths.cache.uri}loan-schedule-template-${Date.now()}.csv`;
      const out = new FileSystemMod.File(cachePath);
      await out.write(text);
      const Sharing = await import("expo-sharing");
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(cachePath, { mimeType: "text/csv" });
      }
      void path;
    } catch (e) {
      alert("Couldn't share template", formatError("Share template", e));
    }
  }, [alert, id]);

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (!loan) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-text-secondary dark:text-text-dark-secondary text-center">
            Loan not found.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const previewRows =
    rows.length > 6 ? [...rows.slice(0, 3), ...rows.slice(-3)] : rows;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 48, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {loan.schedule_source === "manual_csv" && (
          <View
            className="mb-4 rounded-xl px-4 py-3"
            style={{ backgroundColor: acAlpha(accent, 500, 0.1) }}
          >
            <View className="flex-row items-start">
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.tint}
                style={{ marginRight: 10, marginTop: 1 }}
              />
              <View className="flex-1">
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.text }}
                >
                  Using your imported schedule
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{ color: colors.textSecondary }}
                >
                  Arth is treating your CSV as the source of truth. Uploading a new one replaces it. Revert to calculated schedule any time.
                </Text>
              </View>
            </View>
          </View>
        )}

        <Card title="How this works" className="mb-4">
          <Text className="text-sm text-text-primary dark:text-text-dark-primary mb-2">
            Upload a CSV of your loan's schedule from the bank. Arth will use those numbers instead of the calculated ones.
          </Text>
          <Text
            className="text-xs mt-2"
            style={{ color: colors.textSecondary }}
          >
            Required columns (header row + at least one row):
          </Text>
          <View
            className="rounded-lg p-3 mt-2"
            style={{ backgroundColor: colors.surface }}
          >
            <Text
              className="text-xs font-mono"
              style={{ color: colors.text }}
            >
              installment_num, due_date, opening_principal, emi_amount, principal_component, interest_component, closing_principal
            </Text>
          </View>
          <Text
            className="text-xs mt-2"
            style={{ color: colors.textSecondary }}
          >
            Dates must be in YYYY-MM-DD. Amounts can include ₹ / Rs. / commas — Arth will strip them.
          </Text>
        </Card>

        <Card className="mb-3">
          <Pressable
            onPress={handleDownloadTemplate}
            accessibilityRole="button"
            accessibilityLabel="Download blank template pre-filled with today's schedule"
            className="flex-row items-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
            >
              <Ionicons name="download-outline" size={20} color={colors.tint} />
            </View>
            <View className="flex-1">
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                Download template
              </Text>
              <Text
                className="text-xs"
                style={{ color: colors.textSecondary }}
              >
                Pre-filled with Arth's current schedule. Edit amounts in a spreadsheet, then re-import.
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
        </Card>

        <Card className="mb-4">
          <Pressable
            onPress={handlePick}
            accessibilityRole="button"
            accessibilityLabel="Pick a CSV file"
            className="flex-row items-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
            >
              <Ionicons name="document-attach-outline" size={20} color={colors.tint} />
            </View>
            <View className="flex-1">
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                {fileName ? `File: ${fileName}` : "Pick CSV file…"}
              </Text>
              <Text
                className="text-xs"
                style={{ color: colors.textSecondary }}
              >
                {fileName
                  ? `${rows.length} valid ${rows.length === 1 ? "row" : "rows"}${errors.length > 0 ? ` · ${errors.length} ${errors.length === 1 ? "issue" : "issues"}` : ""}`
                  : "Tap to choose a file from your phone"}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
        </Card>

        {errors.length > 0 && (
          <Card className="mb-4" title="Issues">
            {errors.slice(0, 10).map((err, i) => (
              <Text
                key={i}
                className="text-xs mb-1"
                style={{ color: StatusColors[colorScheme].danger }}
              >
                • {err}
              </Text>
            ))}
            {errors.length > 10 && (
              <Text
                className="text-xs mt-1"
                style={{ color: colors.textSecondary }}
              >
                … and {errors.length - 10} more
              </Text>
            )}
          </Card>
        )}

        {rows.length > 0 && (
          <Card title={`Preview · ${rows.length} installments`} className="mb-4">
            <Text
              className="text-xs mb-3"
              style={{ color: colors.textSecondary }}
            >
              {rows.length > 6
                ? `First 3 and last 3 of ${rows.length} rows`
                : `All ${rows.length} rows`}
            </Text>
            {previewRows.map((r, i) => {
              const showDivider =
                rows.length > 6 && i === 2;
              return (
                <View key={`${r.installment_num}-${i}`}>
                  <View className="flex-row items-center py-2">
                    <View style={{ width: 36 }}>
                      <Text
                        className="text-xs"
                        style={{ color: colors.textSecondary }}
                      >
                        #{r.installment_num}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-sm font-medium"
                        style={{ color: colors.text }}
                      >
                        {formatDate(r.due_date)}
                      </Text>
                      <Text
                        className="text-xs mt-0.5"
                        style={{ color: colors.textSecondary }}
                      >
                        P {formatMoney(Math.round(r.principal_component))} · I {formatMoney(Math.round(r.interest_component))}
                      </Text>
                    </View>
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.text }}
                    >
                      {formatMoney(Math.round(r.emi_amount))}
                    </Text>
                  </View>
                  {showDivider && (
                    <View className="items-center py-1">
                      <Text
                        className="text-xs"
                        style={{ color: colors.textSecondary }}
                      >
                        …
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {rows.length > 0 && errors.length === 0 && (
          <View className="mb-3">
            <Button
              title={applying ? "Applying…" : "Apply to this loan"}
              onPress={handleApply}
              loading={applying}
            />
          </View>
        )}

        {loan.schedule_source === "manual_csv" && (
          <View className="mb-3">
            <Button
              title={applying ? "Reverting…" : "Revert to calculated schedule"}
              onPress={handleRevert}
              loading={applying}
              variant="secondary"
            />
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
