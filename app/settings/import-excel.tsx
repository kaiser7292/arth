import { useState, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ScreenContainer, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  pickExcelFile,
  readWorkbook,
  detectSheets,
  parseTemplateRows,
  importExpenses,
  getImportPreview,
  generateTemplateCSV,
  TEMPLATE_COLUMNS,
} from "@/services/excel-import";
import {
  importForecastSheet,
} from "@/services/estimations-import";
import {
  parseHisaabRows,
  getHisaabImportPreview,
  importHisaabEntries,
  generateHisaabTemplateCSV,
  HISAAB_TEMPLATE_COLUMNS,
} from "@/services/hisaab-import";
import type {
  DetectedSheet,
  ParsedExpenseRow,
  ImportResult,
} from "@/services/excel-import";
import type { ForecastImportResult } from "@/services/estimations-import";
import type {
  ParsedHisaabRow,
  HisaabImportResult,
  HisaabImportPreview,
} from "@/services/hisaab-import";
import type * as XLSX from "xlsx";
import { formatAmount } from "@/utils/expense-validation";

type Step = "pick" | "sheets" | "preview" | "importing" | "done";
type ImportMode = "expenses" | "hisaab";

export default function ImportExcelScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();

  // Shared state
  const [importMode, setImportMode] = useState<ImportMode>("expenses");
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState<string>("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheets, setSheets] = useState<DetectedSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<DetectedSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expense-specific state
  const [parsedRows, setParsedRows] = useState<ParsedExpenseRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [forecastResult, setForecastResult] = useState<ForecastImportResult | null>(null);

  // Hisaab-specific state
  const [parsedHisaabRows, setParsedHisaabRows] = useState<ParsedHisaabRow[]>([]);
  const [hisaabResult, setHisaabResult] = useState<HisaabImportResult | null>(null);

  // Switch import mode — resets all state
  const handleModeChange = useCallback((mode: ImportMode) => {
    setImportMode(mode);
    setStep("pick");
    setFileName("");
    setWorkbook(null);
    setSheets([]);
    setSelectedSheet(null);
    setParsedRows([]);
    setParsedHisaabRows([]);
    setImportResult(null);
    setHisaabResult(null);
    setForecastResult(null);
    setError(null);
  }, []);

  // Download template CSV
  const handleDownloadTemplate = useCallback(async () => {
    try {
      const csv = importMode === "hisaab" ? generateHisaabTemplateCSV() : generateTemplateCSV();
      const name = importMode === "hisaab" ? "artha_hisaab_template.csv" : "artha_import_template.csv";
      const file = new File(Paths.cache, name);
      file.write(csv);
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/csv",
        dialogTitle: "Save import template",
        UTI: "public.comma-separated-values-text",
      });
    } catch (e) {
      logger.error("Generate template failed:", e);
      alert("Error", formatError("Generate template", e));
    }
  }, [importMode]);

  // Pick file and parse
  const handlePickFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const file = await pickExcelFile();
      if (!file) {
        setLoading(false);
        return;
      }
      setFileName(file.name);
      const wb = await readWorkbook(file.uri);
      setWorkbook(wb);
      const detected = detectSheets(wb);
      setSheets(detected);

      // If single sheet, auto-select and go to preview
      if (detected.length === 1) {
        handleSelectSheet(detected[0], wb);
      } else {
        setStep("sheets");
      }
    } catch (e) {
      setError(`Could not read file: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [importMode]);

  // Select sheet → parse → preview
  const handleSelectSheet = useCallback(
    (sheet: DetectedSheet, wb?: XLSX.WorkBook) => {
      const book = wb ?? workbook;
      if (!book) return;
      setSelectedSheet(sheet);

      // Hisaab mode: use hisaab parser
      if (importMode === "hisaab") {
        const rows = parseHisaabRows(book, sheet.name);
        if (rows.length === 0) {
          setError(
            "No valid rows found. Make sure your file has columns: " +
              HISAAB_TEMPLATE_COLUMNS.join(", ") +
              "\nPerson, Amount, and Type are required.",
          );
          setStep("pick");
          return;
        }
        setParsedHisaabRows(rows);
        setStep("preview");
        return;
      }

      // Forecast sheet
      if (sheet.sheetType === "forecast") {
        handleForecastImport(sheet, book);
        return;
      }

      // Expense mode: use expense parser
      const rows = parseTemplateRows(book, sheet.name);
      if (rows.length === 0) {
        setError(
          "No valid rows found. Make sure your file has columns: " +
            TEMPLATE_COLUMNS.join(", ") +
            "\nDate and Amount are required.",
        );
        setStep("pick");
        return;
      }
      setParsedRows(rows);
      setStep("preview");
    },
    [workbook, importMode],
  );

  // Import forecast sheet
  const handleForecastImport = useCallback(
    async (sheet: DetectedSheet, wb: XLSX.WorkBook) => {
      setStep("importing");
      try {
        const yearMatch = sheet.name.match(/(\d{4})/);
        const startYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
        const fy = String(startYear);

        const result = await importForecastSheet(DEFAULT_USER_ID, wb, {
          sheetName: sheet.name,
          financialYear: fy,
          fyStartMonth: 4,
        });
        setForecastResult(result);
        setStep("done");
      } catch (e) {
        setError(`Forecast import failed: ${e instanceof Error ? e.message : String(e)}`);
        setStep("pick");
      }
    },
    [],
  );

  // Import expenses
  const handleImport = useCallback(async () => {
    setStep("importing");
    try {
      const result = await importExpenses(DEFAULT_USER_ID, parsedRows);
      setImportResult(result);
      setStep("done");
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("preview");
    }
  }, [parsedRows]);

  // Import hisaab entries
  const handleHisaabImport = useCallback(async () => {
    setStep("importing");
    try {
      const result = await importHisaabEntries(DEFAULT_USER_ID, parsedHisaabRows);
      setHisaabResult(result);
      setStep("done");
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("preview");
    }
  }, [parsedHisaabRows]);

  const preview = parsedRows.length > 0 ? getImportPreview(parsedRows) : null;
  const hisaabPreview = parsedHisaabRows.length > 0 ? getHisaabImportPreview(parsedHisaabRows) : null;

  const templateColumns = importMode === "hisaab" ? HISAAB_TEMPLATE_COLUMNS : TEMPLATE_COLUMNS;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Import Mode Toggle */}
        <View className="flex-row bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-1 mt-2 mb-4">
          <Pressable
            onPress={() => handleModeChange("expenses")}
            className={`flex-1 py-2.5 rounded-lg items-center ${importMode === "expenses" ? "bg-white dark:bg-surface-dark shadow-sm" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${importMode === "expenses" ? "text-text-primary dark:text-text-dark-primary" : "text-text-secondary dark:text-text-dark-secondary"}`}
            >
              Expenses
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleModeChange("hisaab")}
            className={`flex-1 py-2.5 rounded-lg items-center ${importMode === "hisaab" ? "bg-white dark:bg-surface-dark shadow-sm" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${importMode === "hisaab" ? "text-text-primary dark:text-text-dark-primary" : "text-text-secondary dark:text-text-dark-secondary"}`}
            >
              Hisaab Ledger
            </Text>
          </Pressable>
        </View>

        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6">
          {importMode === "hisaab"
            ? "Import hisaab (ledger) entries from a CSV or Excel file."
            : "Import your expenses from a CSV or Excel file."}
        </Text>

        {error && (
          <View className="bg-[#EF444414] rounded-lg p-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
            <Pressable onPress={() => setError(null)} className="mt-1">
              <Text className="text-xs text-danger underline">Dismiss</Text>
            </Pressable>
          </View>
        )}

        {/* Step 1: Pick File */}
        {step === "pick" && (
          <View>
            {/* Template download card */}
            <View className="rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surface-dark-alt p-4 mb-4">
              <View className="flex-row items-center mb-3">
                <View className="w-10 h-10 rounded-full bg-[#22C55E14] items-center justify-center mr-3">
                  <Ionicons name="download-outline" size={20} color={StatusColors[colorScheme].success} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                    Step 1: Get the template
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {importMode === "hisaab"
                      ? "Download, fill in your hisaab entries, then upload"
                      : "Download, fill in your expenses, then upload"}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleDownloadTemplate}
                className="flex-row items-center justify-center py-2.5 rounded-lg bg-success/8"
                style={{ borderWidth: 1, borderColor: StatusColors[colorScheme].success }}
              >
                <Ionicons name="download-outline" size={18} color={StatusColors[colorScheme].success} />
                <Text className="text-sm font-semibold text-success ml-2">
                  Download CSV Template
                </Text>
              </Pressable>

              {/* Template columns info */}
              <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1.5">
                  Template columns:
                </Text>
                <View className="flex-row flex-wrap">
                  {templateColumns.map((col, i) => {
                    const isRequired = importMode === "hisaab"
                      ? col === "Person" || col === "Amount" || col === "Type"
                      : i < 2;
                    return (
                      <View
                        key={col}
                        className="px-2 py-1 rounded bg-surface-light-alt dark:bg-surface-dark mr-1.5 mb-1.5"
                      >
                        <Text className="text-xs text-text-primary dark:text-text-dark-secondary">
                          {col}
                          {isRequired && (
                            <Text className="text-danger"> *</Text>
                          )}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text className="text-[10px] text-text-tertiary mt-1">
                  {importMode === "hisaab"
                    ? "* Required. Types: debit, credit, settlement, initial_balance. Date optional for initial_balance."
                    : "* Required fields. Supports dates like 2025-05-15 or 15/05/2025."}
                </Text>
              </View>
            </View>

            {/* Upload card */}
            <View className="items-center py-8 rounded-lg border-2 border-dashed border-border-light dark:border-border-dark mb-4">
              <View className="w-16 h-16 rounded-2xl items-center justify-center mb-3" style={{ backgroundColor: accent[500] + '14' }}>
                <Ionicons name="cloud-upload-outline" size={32} color={colors.blue} />
              </View>
              <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary mb-1">
                Step 2: Upload your file
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4 text-center px-4">
                Accepts .csv and .xlsx files
              </Text>
              <Button
                title="Choose File"
                onPress={handlePickFile}
                disabled={loading}
                loading={loading}
              />
            </View>
          </View>
        )}

        {/* Step 2: Sheet selection (only for multi-sheet Excel files) */}
        {step === "sheets" && (
          <View>
            <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4">
              {sheets.length} sheets found. Select one to import:
            </Text>

            {sheets.map((sheet) => (
              <Pressable
                key={sheet.name}
                onPress={() => handleSelectSheet(sheet)}
                className="flex-row items-center p-4 mb-2 rounded-lg border border-border-light dark:border-border-dark"
              >
                <View className="flex-1">
                  <View className="flex-row items-center mb-1">
                    <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary">
                      {sheet.name}
                    </Text>
                    {sheet.sheetType !== "unknown" && (
                      <View className="ml-2 rounded px-2 py-0.5" style={{ backgroundColor: accent[500] + '14' }}>
                        <Text className="text-xs" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                          {sheet.sheetType.replace("_", " ")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                    {sheet.rowCount} rows
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </Pressable>
            ))}

            <Pressable onPress={() => setStep("pick")} className="mt-4 py-3 items-center">
              <Text className="font-medium" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                Choose a different file
              </Text>
            </Pressable>
          </View>
        )}

        {/* Step 3: Preview — Expenses */}
        {step === "preview" && importMode === "expenses" && preview && (
          <View>
            <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4">
              Ready to import
            </Text>

            <View className="rounded-lg border border-border-light dark:border-border-dark p-4 mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Expenses</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {preview.count}
                </Text>
              </View>
              {preview.dateRange && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Date range</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {preview.dateRange.from} → {preview.dateRange.to}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total amount</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(preview.totalAmount)}
                </Text>
              </View>
              {preview.uniqueCategories.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Categories</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {preview.uniqueCategories.length}
                  </Text>
                </View>
              )}
              {preview.uniquePaymentModes.length > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Payment modes</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {preview.uniquePaymentModes.length}
                  </Text>
                </View>
              )}
            </View>

            {/* Sample rows */}
            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mb-2">
              Sample rows:
            </Text>
            {parsedRows.slice(0, 5).map((row, i) => (
              <View
                key={i}
                className="flex-row items-center p-3 mb-1 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt"
              >
                <View className="flex-1">
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                    {row.description ?? row.merchantName ?? "—"}{" "}
                    {row.categoryName ? `(${row.categoryName})` : ""}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {row.date}
                    {row.merchantName && row.description ? ` · ${row.merchantName}` : ""}
                    {row.paymentModeName ? ` · ${row.paymentModeName}` : ""}
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(row.amount)}
                </Text>
              </View>
            ))}
            {parsedRows.length > 5 && (
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center mt-1">
                + {parsedRows.length - 5} more rows
              </Text>
            )}

            {(preview.uniqueCategories.length > 0 || preview.uniquePaymentModes.length > 0) && (
              <View className="mt-4 p-3 rounded-lg bg-[#F59E0B14]">
                <Text className="text-sm font-medium mb-1" style={{ color: StatusColors[colorScheme].warning }}>
                  New items will be auto-created
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Categories and payment modes not in the app will be created automatically.
                </Text>
              </View>
            )}

            <View className="flex-row mt-6 mb-6">
              <Pressable
                onPress={() => {
                  setParsedRows([]);
                  setStep("pick");
                }}
                className="flex-1 border border-border-light dark:border-border-dark rounded-lg py-3 mr-2 items-center"
              >
                <Text className="text-text-primary dark:text-text-dark-primary font-medium">Back</Text>
              </Pressable>
              <Pressable
                onPress={handleImport}
                className="flex-1 rounded-lg py-3 ml-2 items-center"
                style={{ backgroundColor: StatusColors[colorScheme].success }}
              >
                <Text className="text-white font-bold">
                  Import {preview.count} Expenses
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Step 3: Preview — Hisaab */}
        {step === "preview" && importMode === "hisaab" && hisaabPreview && (
          <View>
            <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4">
              Ready to import hisaab entries
            </Text>

            {/* Summary card */}
            <View className="rounded-lg border border-border-light dark:border-border-dark p-4 mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Persons</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {hisaabPreview.personCount}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Entries</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {hisaabPreview.entryCount}
                </Text>
              </View>
              {hisaabPreview.dateRange && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Date range</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {hisaabPreview.dateRange.from} → {hisaabPreview.dateRange.to}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total debits</Text>
                <Text className="text-sm font-semibold text-danger">
                  {formatAmount(hisaabPreview.totalDebits)}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total credits</Text>
                <Text className="text-sm font-semibold text-success">
                  {formatAmount(hisaabPreview.totalCredits)}
                </Text>
              </View>
            </View>

            {/* Per-person breakdown */}
            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mb-2">
              Person breakdown:
            </Text>
            {hisaabPreview.persons.map((person) => (
              <View
                key={person.name}
                className="p-3 mb-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt"
              >
                <View className="flex-row justify-between items-center mb-1">
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {person.name}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {person.entries} entries
                  </Text>
                </View>
                {person.initialBalance !== null && (
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      Initial balance
                    </Text>
                    <Text
                      className={`text-xs font-medium ${person.initialBalance >= 0 ? "text-danger" : "text-success"}`}
                    >
                      {formatAmount(Math.abs(person.initialBalance))}
                      {person.initialBalance >= 0 ? " owed" : " you owe"}
                    </Text>
                  </View>
                )}
                {person.entries > 0 && (
                  <View className="flex-row justify-between mt-0.5">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      Debits / Credits
                    </Text>
                    <Text className="text-xs text-text-primary dark:text-text-dark-secondary">
                      {formatAmount(person.debits)} / {formatAmount(person.credits)}
                    </Text>
                  </View>
                )}
              </View>
            ))}

            {/* Auto-create notice */}
            <View className="mt-3 p-3 rounded-lg bg-[#F59E0B14]">
              <Text className="text-sm font-medium mb-1" style={{ color: StatusColors[colorScheme].warning }}>
                Persons will be auto-created
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                New persons not already in your hisaab will be created automatically.
              </Text>
            </View>

            <View className="flex-row mt-6 mb-6">
              <Pressable
                onPress={() => {
                  setParsedHisaabRows([]);
                  setStep("pick");
                }}
                className="flex-1 border border-border-light dark:border-border-dark rounded-lg py-3 mr-2 items-center"
              >
                <Text className="text-text-primary dark:text-text-dark-primary font-medium">Back</Text>
              </Pressable>
              <Pressable
                onPress={handleHisaabImport}
                className="flex-1 rounded-lg py-3 ml-2 items-center"
                style={{ backgroundColor: StatusColors[colorScheme].success }}
              >
                <Text className="text-white font-bold">
                  Import {hisaabPreview.entryCount} Entries
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Step 4: Importing */}
        {step === "importing" && (
          <View className="items-center py-20">
            <ActivityIndicator size="large" color={colors.blue} />
            <Text className="text-base text-text-primary dark:text-text-dark-primary mt-4">
              Importing...
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1">
              This may take a moment.
            </Text>
          </View>
        )}

        {/* Step 5: Done — Forecast */}
        {step === "done" && forecastResult && !importResult && !hisaabResult && (
          <View className="items-center py-8">
            <View className="w-16 h-16 rounded-full bg-success/8 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={40} color={StatusColors[colorScheme].success} />
            </View>
            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              Forecast Imported
            </Text>
            <View className="w-full rounded-lg border border-border-light dark:border-border-dark p-4 mt-4">
              {forecastResult.yearlyPlanCreated && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Yearly Plan</Text>
                  <Text className="text-sm font-semibold text-success">Created</Text>
                </View>
              )}
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Budget entries</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {forecastResult.budgetsCreated}
                </Text>
              </View>
              {forecastResult.errors.length > 0 && (
                <View className="mt-2 p-2 rounded bg-[#EF444414]">
                  <Text className="text-xs text-danger">
                    {forecastResult.errors.length} error(s)
                  </Text>
                </View>
              )}
            </View>
            <Button title="Done" onPress={() => router.back()} className="mt-6" />
          </View>
        )}

        {/* Step 5: Done — Expenses */}
        {step === "done" && importResult && (
          <View className="items-center py-8">
            <View className="w-16 h-16 rounded-full bg-success/8 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={40} color={StatusColors[colorScheme].success} />
            </View>
            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              Import Complete
            </Text>
            <View className="w-full rounded-lg border border-border-light dark:border-border-dark p-4 mt-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total rows</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {importResult.totalRows}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Imported</Text>
                <Text className="text-sm font-semibold text-success">{importResult.imported}</Text>
              </View>
              {importResult.skipped > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Skipped</Text>
                  <Text className="text-sm font-semibold text-danger">{importResult.skipped}</Text>
                </View>
              )}
              {importResult.categoriesCreated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">New categories</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {importResult.categoriesCreated.length}
                  </Text>
                </View>
              )}
              {importResult.paymentModesCreated.length > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">New payment modes</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {importResult.paymentModesCreated.length}
                  </Text>
                </View>
              )}
            </View>
            {importResult.errors.length > 0 && (
              <View className="w-full mt-4 p-3 rounded-lg bg-[#EF444414]">
                <Text className="text-sm font-medium text-danger mb-1">
                  {importResult.errors.length} error{importResult.errors.length > 1 ? "s" : ""}
                </Text>
                {importResult.errors.slice(0, 5).map((err, i) => (
                  <Text key={i} className="text-xs text-text-secondary dark:text-text-dark-secondary">{err}</Text>
                ))}
              </View>
            )}
            <Button title="Done" onPress={() => router.back()} className="mt-6" />
          </View>
        )}

        {/* Step 5: Done — Hisaab */}
        {step === "done" && hisaabResult && (
          <View className="items-center py-8">
            <View className="w-16 h-16 rounded-full bg-success/8 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={40} color={StatusColors[colorScheme].success} />
            </View>
            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              Hisaab Import Complete
            </Text>
            <View className="w-full rounded-lg border border-border-light dark:border-border-dark p-4 mt-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total rows</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {hisaabResult.totalRows}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Entries imported</Text>
                <Text className="text-sm font-semibold text-success">{hisaabResult.entriesImported}</Text>
              </View>
              {hisaabResult.personsCreated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Persons created</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {hisaabResult.personsCreated.join(", ")}
                  </Text>
                </View>
              )}
              {hisaabResult.personsUpdated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Persons updated</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {hisaabResult.personsUpdated.join(", ")}
                  </Text>
                </View>
              )}
              {hisaabResult.skipped > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Skipped</Text>
                  <Text className="text-sm font-semibold text-danger">{hisaabResult.skipped}</Text>
                </View>
              )}
            </View>
            {hisaabResult.errors.length > 0 && (
              <View className="w-full mt-4 p-3 rounded-lg bg-[#EF444414]">
                <Text className="text-sm font-medium text-danger mb-1">
                  {hisaabResult.errors.length} error{hisaabResult.errors.length > 1 ? "s" : ""}
                </Text>
                {hisaabResult.errors.slice(0, 5).map((err, i) => (
                  <Text key={i} className="text-xs text-text-secondary dark:text-text-dark-secondary">{err}</Text>
                ))}
              </View>
            )}
            <Button title="Done" onPress={() => router.back()} className="mt-6" />
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
