import { useState, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";


import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  pickExcelFile,
  readWorkbook,
  detectSheets,
} from "@/services/excel-import";
import {
  TRANSACTION_REQUIRED_COLUMNS,
  TRANSACTION_TEMPLATE_COLUMNS,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  generateTransactionTemplateCSV,
  getTransactionImportPreview,
  importTransactions,
  loadImportContext,
  parseTransactionRows,
  planTransactionImport,
} from "@/services/transaction-import";
import type {
  ImportPlan,
  ImportPreview,
  TransactionImportResult,
} from "@/services/transaction-import";
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
import type { DetectedSheet } from "@/services/excel-import";
import type { ForecastImportResult } from "@/services/estimations-import";
import type {
  ParsedHisaabRow,
  HisaabImportResult,
  HisaabImportPreview,
} from "@/services/hisaab-import";
import type * as XLSX from "xlsx";
import { formatAmount } from "@/utils/expense-validation";
import { useTheme } from "@/hooks/use-theme";

type Step = "pick" | "sheets" | "preview" | "importing" | "done";
type ImportMode = "transactions" | "hisaab";

/** How many skipped rows to spell out before summarising the rest. */
const SKIPPED_SHOWN = 8;

export default function ImportExcelScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  // Shared state
  const [importMode, setImportMode] = useState<ImportMode>("transactions");
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState<string>("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheets, setSheets] = useState<DetectedSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<DetectedSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transaction-specific state
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<TransactionImportResult | null>(null);
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
    setPlan(null);
    setPreview(null);
    setParsedHisaabRows([]);
    setImportResult(null);
    setHisaabResult(null);
    setForecastResult(null);
    setError(null);
  }, []);

  // Download template CSV
  const handleDownloadTemplate = useCallback(async () => {
    try {
      const csv = importMode === "hisaab" ? generateHisaabTemplateCSV() : generateTransactionTemplateCSV();
      const name = importMode === "hisaab" ? "arth_hisaab_template.csv" : "arth_transactions_template.csv";
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
        await handleSelectSheet(detected[0], wb);
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
    async (sheet: DetectedSheet, wb?: XLSX.WorkBook) => {
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

      // Transactions: read the rows, then work out what would be imported
      const parsed = parseTransactionRows(book, sheet.name);
      if (parsed.rows.length === 0) {
        setError(
          "No rows could be read. Make sure your file has the template's columns: " +
            TRANSACTION_TEMPLATE_COLUMNS.join(", ") +
            "\nDate and Amount are required." +
            (parsed.skipped.length > 0 ? `\nRow ${parsed.skipped[0].rowNumber}: ${parsed.skipped[0].reason}.` : ""),
        );
        setStep("pick");
        return;
      }
      try {
        const ctx = await loadImportContext(DEFAULT_USER_ID, parsed.rows);
        const planned = planTransactionImport(parsed.rows, ctx);
        // Rows the sheet reader couldn't use are listed with the rest.
        planned.skipped = [...parsed.skipped, ...planned.skipped].sort((a, b) => a.rowNumber - b.rowNumber);
        setPlan(planned);
        setPreview(getTransactionImportPreview(planned.ready, { categories: ctx.categories, paymentModes: ctx.paymentModes }));
        setStep("preview");
      } catch (e) {
        logger.error("Import preview failed:", e);
        setError(`Could not check the file against your data: ${e instanceof Error ? e.message : String(e)}`);
        setStep("pick");
      }
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

  // Import transactions
  const handleImport = useCallback(async () => {
    if (!plan) return;
    setStep("importing");
    try {
      const result = await importTransactions(DEFAULT_USER_ID, plan.ready);
      setImportResult(result);
      setStep("done");
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("preview");
    }
  }, [plan]);

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

  const hisaabPreview = parsedHisaabRows.length > 0 ? getHisaabImportPreview(parsedHisaabRows) : null;

  const templateColumns: readonly string[] = importMode === "hisaab" ? HISAAB_TEMPLATE_COLUMNS : TRANSACTION_TEMPLATE_COLUMNS;
  const importedTotal = importResult ? TRANSACTION_TYPES.reduce((n, t) => n + importResult.imported[t], 0) : 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Import Mode Toggle */}
        <View className="flex-row bg-card rounded-xl p-1 mt-2 mb-4">
          <Pressable
            onPress={() => handleModeChange("transactions")}
            className={`flex-1 py-2.5 rounded-lg items-center ${importMode === "transactions" ? "bg-card shadow-sm" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${importMode === "transactions" ? "text-foreground" : "text-muted-foreground"}`}
            >
              Transactions
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleModeChange("hisaab")}
            className={`flex-1 py-2.5 rounded-lg items-center ${importMode === "hisaab" ? "bg-card shadow-sm" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${importMode === "hisaab" ? "text-foreground" : "text-muted-foreground"}`}
            >
              Hisaab Ledger
            </Text>
          </Pressable>
        </View>

        <Text className="text-sm text-muted-foreground mb-6">
          {importMode === "hisaab"
            ? "Import hisaab (ledger) entries from a CSV or Excel file."
            : "Import expenses, committed payments, credits and transfers from a CSV or Excel file."}
        </Text>

        {error && (
          <View className="bg-danger/8 rounded-lg p-3 mb-4">
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
            <View className="rounded-lg border border-border bg-card p-4 mb-4">
              <View className="flex-row items-center mb-3">
                <View className="w-10 h-10 rounded-full bg-success/8 items-center justify-center mr-3">
                  <Ionicons name="download-outline" size={20} color={theme.success} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    Step 1: Get the template
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {importMode === "hisaab"
                      ? "Download, fill in your hisaab entries, then upload"
                      : "Download, fill in your transactions, then upload"}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleDownloadTemplate}
                className="flex-row items-center justify-center py-2.5 rounded-lg bg-success/8"
                style={{ borderWidth: 1, borderColor: theme.success }}
              >
                <Ionicons name="download-outline" size={18} color={theme.success} />
                <Text className="text-sm font-semibold text-success ml-2">
                  Download CSV Template
                </Text>
              </Pressable>

              {/* Template columns info */}
              <View className="mt-3 pt-3 border-t border-border">
                <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Template columns:
                </Text>
                <View className="flex-row flex-wrap">
                  {templateColumns.map((col) => {
                    const isRequired = importMode === "hisaab"
                      ? col === "Person" || col === "Amount" || col === "Type"
                      : TRANSACTION_REQUIRED_COLUMNS.includes(col);
                    return (
                      <View
                        key={col}
                        className="px-2 py-1 rounded bg-background mr-1.5 mb-1.5"
                      >
                        <Text className="text-xs text-muted-foreground">
                          {col}
                          {isRequired && (
                            <Text className="text-danger"> *</Text>
                          )}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text className="text-label text-faint-foreground mt-1">
                  {importMode === "hisaab"
                    ? "* Required. Types: debit, credit, settlement, initial_balance. Date optional for initial_balance. Category and Merchant are optional."
                    : "* Required. Type is Expense, Committed, Credit or Transfer (blank means Expense). A transfer needs Account and To Account; a committed row needs Linked To (a loan or an investment bucket). Accounts match by name or last 4 digits. Dates like 2026-05-15 or 15/05/2026."}
                </Text>
              </View>
            </View>

            {/* Upload card */}
            <View className="items-center py-8 rounded-lg border-2 border-dashed border-border mb-4">
              <View className="w-16 h-16 rounded-2xl items-center justify-center mb-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                <Ionicons name="cloud-upload-outline" size={32} color={colors.blue} />
              </View>
              <Text className="text-base font-medium text-foreground mb-1">
                Step 2: Upload your file
              </Text>
              <Text className="text-sm text-muted-foreground mb-4 text-center px-4">
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
            <Text className="text-base font-semibold text-foreground mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-muted-foreground mb-4">
              {sheets.length} sheets found. Select one to import:
            </Text>

            {sheets.map((sheet) => (
              <Pressable
                key={sheet.name}
                onPress={() => handleSelectSheet(sheet)}
                className="flex-row items-center p-4 mb-2 rounded-lg border border-border"
              >
                <View className="flex-1">
                  <View className="flex-row items-center mb-1">
                    <Text className="text-base font-medium text-foreground">
                      {sheet.name}
                    </Text>
                    {sheet.sheetType !== "unknown" && (
                      <View className="ml-2 rounded px-2 py-0.5" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                        <Text className="text-xs" style={{ color: theme.primary }}>
                          {sheet.sheetType.replace("_", " ")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-muted-foreground">
                    {sheet.rowCount} rows
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </Pressable>
            ))}

            <Pressable onPress={() => setStep("pick")} className="mt-4 py-3 items-center">
              <Text className="font-medium" style={{ color: theme.primary }}>
                Choose a different file
              </Text>
            </Pressable>
          </View>
        )}

        {/* Step 3: Preview — Transactions */}
        {step === "preview" && importMode === "transactions" && plan && preview && (
          <View>
            <Text className="text-base font-semibold text-foreground mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-muted-foreground mb-4">
              {preview.count > 0 ? "Ready to import" : "Nothing to import"}
            </Text>

            <View className="rounded-lg border border-border p-4 mb-4">
              {TRANSACTION_TYPES.filter((t) => preview.byType[t].count > 0).map((t) => (
                <View key={t} className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">
                    {TRANSACTION_TYPE_LABELS[t]} ({preview.byType[t].count})
                  </Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {formatAmount(preview.byType[t].total)}
                  </Text>
                </View>
              ))}
              {preview.dateRange && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Date range</Text>
                  <Text className="text-sm text-foreground">
                    {preview.dateRange.from} → {preview.dateRange.to}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted-foreground">Will be imported</Text>
                <Text className="text-base font-bold text-foreground">{preview.count}</Text>
              </View>
            </View>

            {plan.skipped.length > 0 && (
              <View className="rounded-lg p-3 mb-4 bg-warning/8">
                <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                  {plan.skipped.length} row{plan.skipped.length > 1 ? "s" : ""} will be left out
                  {plan.duplicates > 0 ? ` (${plan.duplicates} already in Arth)` : ""}
                </Text>
                {plan.skipped
                  .filter((r) => r.reason !== "Already in Arth")
                  .slice(0, SKIPPED_SHOWN)
                  .map((r) => (
                    <Text key={r.rowNumber} className="text-xs text-muted-foreground">
                      Row {r.rowNumber}: {r.reason}
                    </Text>
                  ))}
                {plan.skipped.length - plan.duplicates > SKIPPED_SHOWN && (
                  <Text className="text-xs text-muted-foreground mt-1">
                    + {plan.skipped.length - plan.duplicates - SKIPPED_SHOWN} more
                  </Text>
                )}
              </View>
            )}

            {/* Sample rows */}
            {plan.ready.length > 0 && (
              <Text className="text-sm font-medium text-foreground mb-2">
                Sample rows:
              </Text>
            )}
            {plan.ready.slice(0, 5).map((row) => (
              <View
                key={row.rowNumber}
                className="flex-row items-center p-3 mb-1 rounded-lg bg-card"
              >
                <View className="flex-1">
                  <Text className="text-sm text-foreground" numberOfLines={1}>
                    {row.description ?? row.merchantName ?? TRANSACTION_TYPE_LABELS[row.type]}{" "}
                    {row.categoryName ? `(${row.categoryName})` : ""}
                  </Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {[
                      row.date,
                      TRANSACTION_TYPE_LABELS[row.type],
                      row.type === "transfer" ? `${row.accountName} → ${row.toAccountName}` : row.accountName,
                      row.linkedToName,
                    ].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-foreground">
                  {formatAmount(row.amount)}
                </Text>
              </View>
            ))}
            {plan.ready.length > 5 && (
              <Text className="text-xs text-muted-foreground text-center mt-1">
                + {plan.ready.length - 5} more rows
              </Text>
            )}

            {(preview.newCategories.length > 0 || preview.newPaymentModes.length > 0) && (
              <View className="mt-4 p-3 rounded-lg bg-warning/8">
                <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                  New items will be created
                </Text>
                {preview.newCategories.length > 0 && (
                  <Text className="text-xs text-muted-foreground">
                    Categories: {preview.newCategories.join(", ")}
                  </Text>
                )}
                {preview.newPaymentModes.length > 0 && (
                  <Text className="text-xs text-muted-foreground">
                    Payment modes: {preview.newPaymentModes.join(", ")}
                  </Text>
                )}
              </View>
            )}

            <View className="flex-row mt-6 mb-6">
              <Pressable
                onPress={() => {
                  setPlan(null);
                  setPreview(null);
                  setStep("pick");
                }}
                className="flex-1 border border-border rounded-lg py-3 mr-2 items-center"
              >
                <Text className="text-foreground font-medium">Back</Text>
              </Pressable>
              <Pressable
                onPress={handleImport}
                disabled={preview.count === 0}
                className="flex-1 rounded-lg py-3 ml-2 items-center"
                style={{ backgroundColor: theme.success, opacity: preview.count === 0 ? 0.4 : 1 }}
              >
                <Text className="text-white font-bold">
                  Import {preview.count} Transaction{preview.count !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Step 3: Preview — Hisaab */}
        {step === "preview" && importMode === "hisaab" && hisaabPreview && (
          <View>
            <Text className="text-base font-semibold text-foreground mb-1">
              {fileName}
            </Text>
            <Text className="text-sm text-muted-foreground mb-4">
              Ready to import hisaab entries
            </Text>

            {/* Summary card */}
            <View className="rounded-lg border border-border p-4 mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Persons</Text>
                <Text className="text-base font-bold text-foreground">
                  {hisaabPreview.personCount}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Entries</Text>
                <Text className="text-base font-bold text-foreground">
                  {hisaabPreview.entryCount}
                </Text>
              </View>
              {hisaabPreview.dateRange && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Date range</Text>
                  <Text className="text-sm text-foreground">
                    {hisaabPreview.dateRange.from} → {hisaabPreview.dateRange.to}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Total debits</Text>
                <Text className="text-sm font-semibold text-danger">
                  {formatAmount(hisaabPreview.totalDebits)}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted-foreground">Total credits</Text>
                <Text className="text-sm font-semibold text-success">
                  {formatAmount(hisaabPreview.totalCredits)}
                </Text>
              </View>
            </View>

            {/* Per-person breakdown */}
            <Text className="text-sm font-medium text-foreground mb-2">
              Person breakdown:
            </Text>
            {hisaabPreview.persons.map((person) => (
              <View
                key={person.name}
                className="p-3 mb-2 rounded-lg bg-card"
              >
                <View className="flex-row justify-between items-center mb-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {person.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {person.entries} entries
                  </Text>
                </View>
                {person.initialBalance !== null && (
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-muted-foreground">
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
                    <Text className="text-xs text-muted-foreground">
                      Debits / Credits
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {formatAmount(person.debits)} / {formatAmount(person.credits)}
                    </Text>
                  </View>
                )}
              </View>
            ))}

            {/* Auto-create notice */}
            <View className="mt-3 p-3 rounded-lg bg-warning/8">
              <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                Persons will be auto-created
              </Text>
              <Text className="text-xs text-muted-foreground">
                New persons not already in your hisaab will be created automatically.
              </Text>
            </View>

            <View className="flex-row mt-6 mb-6">
              <Pressable
                onPress={() => {
                  setParsedHisaabRows([]);
                  setStep("pick");
                }}
                className="flex-1 border border-border rounded-lg py-3 mr-2 items-center"
              >
                <Text className="text-foreground font-medium">Back</Text>
              </Pressable>
              <Pressable
                onPress={handleHisaabImport}
                className="flex-1 rounded-lg py-3 ml-2 items-center"
                style={{ backgroundColor: theme.success }}
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
            <Text className="text-base text-foreground mt-4">
              Importing...
            </Text>
            <Text className="text-sm text-muted-foreground mt-1">
              This may take a moment.
            </Text>
          </View>
        )}

        {/* Step 5: Done — Forecast */}
        {step === "done" && forecastResult && !importResult && !hisaabResult && (
          <View className="items-center py-8">
            <View className="w-16 h-16 rounded-full bg-success/8 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={40} color={theme.success} />
            </View>
            <Text className="text-xl font-bold text-foreground mb-2">
              Forecast Imported
            </Text>
            <View className="w-full rounded-lg border border-border p-4 mt-4">
              {forecastResult.yearlyPlanCreated && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Yearly Plan</Text>
                  <Text className="text-sm font-semibold text-success">Created</Text>
                </View>
              )}
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Budget entries</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {forecastResult.budgetsCreated}
                </Text>
              </View>
              {forecastResult.errors.length > 0 && (
                <View className="mt-2 p-2 rounded bg-danger/8">
                  <Text className="text-xs text-danger">
                    {forecastResult.errors.length} error(s)
                  </Text>
                </View>
              )}
            </View>
            <Button title="Done" onPress={() => router.back()} className="mt-6" />
          </View>
        )}

        {/* Step 5: Done — Transactions */}
        {step === "done" && importResult && (
          <View className="items-center py-8">
            <View className="w-16 h-16 rounded-full bg-success/8 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={40} color={theme.success} />
            </View>
            <Text className="text-xl font-bold text-foreground mb-2">
              Import Complete
            </Text>
            <View className="w-full rounded-lg border border-border p-4 mt-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Imported</Text>
                <Text className="text-sm font-semibold text-success">{importedTotal}</Text>
              </View>
              {TRANSACTION_TYPES.filter((t) => importResult.imported[t] > 0).map((t) => (
                <View key={t} className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">{TRANSACTION_TYPE_LABELS[t]}</Text>
                  <Text className="text-sm text-foreground">{importResult.imported[t]}</Text>
                </View>
              ))}
              {plan && plan.skipped.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Left out</Text>
                  <Text className="text-sm text-foreground">
                    {plan.skipped.length}
                    {plan.duplicates > 0 ? ` (${plan.duplicates} already in Arth)` : ""}
                  </Text>
                </View>
              )}
              {importResult.categoriesCreated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">New categories</Text>
                  <Text className="text-sm text-foreground">
                    {importResult.categoriesCreated.length}
                  </Text>
                </View>
              )}
              {importResult.paymentModesCreated.length > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted-foreground">New payment modes</Text>
                  <Text className="text-sm text-foreground">
                    {importResult.paymentModesCreated.length}
                  </Text>
                </View>
              )}
            </View>
            {importResult.notLinked.length > 0 && (
              <View className="w-full mt-4 p-3 rounded-lg bg-warning/8">
                <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                  {importResult.notLinked.length} imported as spending, but not linked
                </Text>
                {importResult.notLinked.slice(0, 5).map((r) => (
                  <Text key={r.rowNumber} className="text-xs text-muted-foreground">Row {r.rowNumber}: {r.reason}</Text>
                ))}
              </View>
            )}
            {importResult.failed.length > 0 && (
              <View className="w-full mt-4 p-3 rounded-lg bg-danger/8">
                <Text className="text-sm font-medium text-danger mb-1">
                  {importResult.failed.length} row{importResult.failed.length > 1 ? "s" : ""} could not be saved
                </Text>
                {importResult.failed.slice(0, 5).map((r) => (
                  <Text key={r.rowNumber} className="text-xs text-muted-foreground">Row {r.rowNumber}: {r.reason}</Text>
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
              <Ionicons name="checkmark-circle" size={40} color={theme.success} />
            </View>
            <Text className="text-xl font-bold text-foreground mb-2">
              Hisaab Import Complete
            </Text>
            <View className="w-full rounded-lg border border-border p-4 mt-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Total rows</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {hisaabResult.totalRows}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Entries imported</Text>
                <Text className="text-sm font-semibold text-success">{hisaabResult.entriesImported}</Text>
              </View>
              {hisaabResult.personsCreated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Persons created</Text>
                  <Text className="text-sm text-foreground">
                    {hisaabResult.personsCreated.join(", ")}
                  </Text>
                </View>
              )}
              {hisaabResult.personsUpdated.length > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Persons updated</Text>
                  <Text className="text-sm text-foreground">
                    {hisaabResult.personsUpdated.join(", ")}
                  </Text>
                </View>
              )}
              {hisaabResult.duplicates > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Already in Hisaab</Text>
                  <Text className="text-sm text-foreground">{hisaabResult.duplicates}</Text>
                </View>
              )}
              {hisaabResult.skipped > 0 && (
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Skipped</Text>
                  <Text className="text-sm font-semibold text-danger">{hisaabResult.skipped}</Text>
                </View>
              )}
            </View>
            {hisaabResult.errors.length > 0 && (
              <View className="w-full mt-4 p-3 rounded-lg bg-danger/8">
                <Text className="text-sm font-medium text-danger mb-1">
                  {hisaabResult.errors.length} error{hisaabResult.errors.length > 1 ? "s" : ""}
                </Text>
                {hisaabResult.errors.slice(0, 5).map((err, i) => (
                  <Text key={i} className="text-xs text-muted-foreground">{err}</Text>
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
