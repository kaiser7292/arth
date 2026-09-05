/**
 * Export Format Picker — V6.0.1
 *
 * Two-step bottom sheet:
 * 1. Pick date range (presets: This Month, Last Month, This Year, All Time, Custom)
 * 2. Pick format (PDF or Excel)
 *
 * Generates bank-statement-style exports and opens the share sheet.
 */

import { useState, useCallback, useMemo } from "react";
import { View, Pressable, Modal, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { useAlert } from "@/hooks/use-alert";
import { DateInput, Text } from "@/components/ui";
import { ac, acAlpha } from "@/utils/accent";
import * as Sharing from "expo-sharing";
import { generatePersonPDF } from "@/services/hisaab-export-pdf";
import { generatePersonExcel } from "@/services/hisaab-export-excel";
import { saveToPhone } from "@/services/save-to-phone";

export type ExportTarget =
  | { type: "person"; personId: string; userId: string };

/** Date range passed to export services */
export interface ExportDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;     // e.g. "April 2026", "All Time"
}

interface ExportFormatPickerProps {
  visible: boolean;
  onClose: () => void;
  target: ExportTarget;
}

type PresetKey = "this_month" | "last_month" | "this_year" | "all" | "custom";

interface PresetOption {
  key: PresetKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const PRESETS: PresetOption[] = [
  { key: "this_month", label: "This Month", icon: "calendar-outline" },
  { key: "last_month", label: "Last Month", icon: "calendar-outline" },
  { key: "this_year", label: "This Year", icon: "today-outline" },
  { key: "all", label: "All Time", icon: "time-outline" },
  { key: "custom", label: "Custom Range", icon: "options-outline" },
];

interface FormatOption {
  key: "pdf" | "excel";
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  subtitle: string;
}

const FORMAT_OPTIONS_BASE: Omit<FormatOption, "iconColor">[] = [
  {
    key: "pdf",
    icon: "document-outline",
    label: "PDF Statement",
    subtitle: "Bank-style statement with running balance",
  },
  {
    key: "excel",
    icon: "grid-outline",
    label: "Excel Spreadsheet",
    subtitle: "Statement with Dr/Cr columns and totals",
  },
];

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPresetRange(key: PresetKey): { startDate: string; endDate: string; label: string } {
  const now = new Date();
  switch (key) {
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      return { startDate: formatYMD(start), endDate: formatYMD(end), label };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      return { startDate: formatYMD(start), endDate: formatYMD(end), label };
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      const label = `${now.getFullYear()}`;
      return { startDate: formatYMD(start), endDate: formatYMD(end), label };
    }
    case "all":
    default:
      return { startDate: "2000-01-01", endDate: "2099-12-31", label: "All Time" };
  }
}

export function ExportFormatPicker({ visible, onClose, target }: ExportFormatPickerProps) {
  const { accent, colorScheme, colors } = useColorScheme();
  const alert = useAlert();

  // Step state: "range" -> "format"
  const [step, setStep] = useState<"range" | "format">("range");
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [dateRange, setDateRange] = useState<ExportDateRange | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeFormat, setActiveFormat] = useState<string | null>(null);


  // Compute format options with theme-aware status colors
  const FORMAT_OPTIONS: FormatOption[] = FORMAT_OPTIONS_BASE.map((opt) => ({
    ...opt,
    iconColor: opt.key === "pdf" ? StatusColors[colorScheme].danger : StatusColors[colorScheme].success,
  }));

  // Reset state when modal opens/closes
  const handleClose = useCallback(() => {
    setStep("range");
    setSelectedPreset("this_month");
    setCustomStart("");
    setCustomEnd("");
    setDateRange(null);
    setExporting(false);
    setActiveFormat(null);
    onClose();
  }, [onClose]);

  // Validate custom range
  const customValid = useMemo(() => {
    if (selectedPreset !== "custom") return true;
    if (!customStart || !customEnd) return false;
    return customStart <= customEnd;
  }, [selectedPreset, customStart, customEnd]);

  const handlePresetSelect = useCallback((key: PresetKey) => {
    setSelectedPreset(key);
  }, []);

  const handleNext = useCallback(() => {
    let range: ExportDateRange;
    if (selectedPreset === "custom") {
      range = {
        startDate: customStart,
        endDate: customEnd,
        label: `${customStart} to ${customEnd}`,
      };
    } else {
      range = getPresetRange(selectedPreset);
    }
    setDateRange(range);
    setStep("format");
  }, [selectedPreset, customStart, customEnd]);

  const handleBack = useCallback(() => {
    setStep("range");
  }, []);

  const handleExport = useCallback(async (format: "pdf" | "excel") => {
    if (!dateRange) return;
    setExporting(true);
    setActiveFormat(format);

    try {
      let shareUri: string;
      let fileName: string;

      if (format === "pdf") {
        shareUri = await generatePersonPDF(target.personId, target.userId, dateRange);
        fileName = shareUri.split("/").pop() ?? "statement.pdf";
      } else {
        const result = await generatePersonExcel(target.personId, target.userId, dateRange);
        shareUri = result.filePath;
        fileName = result.fileName;
      }

      const mimeType = format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      handleClose();

      // v16.0.8 — on Android offer 3-way choice: Save to Phone (SAF folder
      // picker), Share (system share sheet), or Later. On iOS there's no
      // SAF equivalent, so jump straight to Share.
      if (Platform.OS === "android") {
        alert(
          "Export ready",
          `${fileName} is ready.`,
          [
            { text: "Later", style: "cancel" },
            {
              text: "Save to Phone",
              onPress: async () => {
                const result = await saveToPhone({
                  sourcePath: shareUri,
                  encoding: "base64",
                  mimeType,
                  fileName,
                });
                if (result.cancelled) return;
                if (!result.ok) {
                  alert("Couldn't save", result.error ?? "Please try again.");
                  return;
                }
                alert("Saved", "File saved to the folder you chose.");
              },
            },
            {
              text: "Share...",
              onPress: async () => {
                await Sharing.shareAsync(shareUri, { mimeType });
              },
            },
          ],
        );
      } else {
        await Sharing.shareAsync(shareUri, { mimeType });
      }
    } catch (e) {
      alert("Export Failed", e instanceof Error ? e.message : String(e));
    }

    setExporting(false);
    setActiveFormat(null);
  }, [target, dateRange, handleClose, alert]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable
        onPress={handleClose}
        className="flex-1 bg-black/40 justify-end"
      >
        <Pressable
          onPress={() => {}}
          className="bg-background rounded-t-2xl"
        >
          {/* Handle bar */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>

          {step === "range" ? (
            /* ─── Step 1: Date Range ─── */
            <View>
              {/* Title */}
              <View className="px-5 pb-3">
                <Text className="text-lg font-bold text-foreground">
                  Statement Period
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Choose the date range for your statement
                </Text>
              </View>

              <View className="px-5 pb-4">
                  {/* Preset chips */}
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {PRESETS.map((preset) => {
                      const isSelected = selectedPreset === preset.key;
                      return (
                        <Pressable
                          key={preset.key}
                          onPress={() => handlePresetSelect(preset.key)}
                          accessibilityLabel={`Select ${preset.label}`}
                          accessibilityRole="button"
                          className="flex-row items-center py-2 px-3 rounded-full border"
                          style={isSelected
                            ? { borderColor: accent[500], backgroundColor: acAlpha(accent, 500, 0.08) }
                            : { borderColor: colors.border }
                          }
                        >
                          <Ionicons
                            name={preset.icon}
                            size={14}
                            color={isSelected ? accent[500] : colors.textSecondary}
                          />
                          <Text
                            className="text-xs font-semibold ml-1.5"
                            style={{ color: isSelected ? accent[500] : colors.textSecondary }}
                          >
                            {preset.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Custom date inputs */}
                  {selectedPreset === "custom" && (
                    <View className="flex-row gap-3 mt-1">
                      <DateInput
                        label="From"
                        value={customStart}
                        onChange={setCustomStart}
                        placeholder="YYYY-MM-DD"
                        maximumDate={null}
                        containerClassName="flex-1"
                      />
                      <DateInput
                        label="To"
                        value={customEnd}
                        onChange={setCustomEnd}
                        placeholder="YYYY-MM-DD"
                        maximumDate={null}
                        containerClassName="flex-1"
                      />
                    </View>
                  )}

                  {selectedPreset === "custom" && !customValid && customStart && customEnd && (
                    <Text className="text-xs text-danger mt-1.5">
                      Start date must be before end date
                    </Text>
                  )}

                  {/* Preview of selected range */}
                  {selectedPreset !== "custom" && (
                    <View className="mt-1 px-1">
                      <Text className="text-xs text-faint-foreground">
                        {getPresetRange(selectedPreset).startDate} → {getPresetRange(selectedPreset).endDate}
                      </Text>
                    </View>
                  )}
                </View>

              {/* Next button */}
              <Pressable
                onPress={handleNext}
                disabled={selectedPreset === "custom" && !customValid}
                accessibilityLabel="Continue to format selection"
                accessibilityRole="button"
                className="mx-5 mb-3 py-3.5 rounded-xl items-center"
                style={{
                  backgroundColor: (selectedPreset === "custom" && !customValid)
                    ? colors.border
                    : accent[500],
                }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{
                    color: (selectedPreset === "custom" && !customValid)
                      ? colors.textSecondary
                      : "#FFFFFF",
                  }}
                >
                  Next - Choose Format
                </Text>
              </Pressable>

              {/* Cancel */}
              <Pressable
                onPress={handleClose}
                className="mx-5 mb-6 py-3 rounded-xl bg-card items-center"
              >
                <Text className="text-sm font-semibold text-muted-foreground">
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : (
            /* ─── Step 2: Format Selection ─── */
            <View>
              {/* Title with back */}
              <View className="px-5 pb-3 flex-row items-center">
                <Pressable
                  onPress={handleBack}
                  disabled={exporting}
                  accessibilityLabel="Go back to date range"
                  accessibilityRole="button"
                  className="mr-2 w-9 h-9 rounded-full items-center justify-center"
                  style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                >
                  <Ionicons name="chevron-back" size={18} color={accent[500]} />
                </Pressable>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    Export Format
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {dateRange?.label ?? "All Time"}
                  </Text>
                </View>
              </View>

              {/* Format options */}
              <View className="px-5 pb-6">
                {FORMAT_OPTIONS.map((option) => {
                  const isActive = exporting && activeFormat === option.key;
                  const isDisabled = exporting && activeFormat !== option.key;

                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleExport(option.key)}
                      disabled={exporting}
                      accessibilityLabel={`Export as ${option.label}`}
                      accessibilityRole="button"
                      className={`flex-row items-center py-3.5 px-4 mb-2 rounded-xl border ${
                        isDisabled
                          ? "border-border opacity-40"
                          : isActive
                            ? ""
                            : "border-border"
                      }`}
                      style={isActive ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 900) } : undefined}
                    >
                      <View
                        className="w-10 h-10 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: option.iconColor + "14" }}
                      >
                        {isActive ? (
                          <ActivityIndicator size="small" color={option.iconColor} />
                        ) : (
                          <Ionicons name={option.icon} size={20} color={option.iconColor} />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          {option.label}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {isActive ? "Generating..." : option.subtitle}
                        </Text>
                      </View>
                      <Ionicons name="share-outline" size={16} color={colors.textSecondary} />
                    </Pressable>
                  );
                })}
              </View>

              {/* Cancel */}
              <Pressable
                onPress={handleClose}
                disabled={exporting}
                className="mx-5 mb-6 py-3 rounded-xl bg-card items-center"
              >
                <Text className="text-sm font-semibold text-muted-foreground">
                  Cancel
                </Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
