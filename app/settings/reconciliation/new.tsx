import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Card, ScreenContainer } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  createSession,
  findExistingSession,
  bulkInsertItems,
  updateSession,
} from "@/services/reconciliation/reconciliation-crud";
import { parseXlsFile, type ParsedStatement, ParseError, XlsPasswordError } from "@/services/reconciliation/xls-parser";
import { parsePdfStatement, PdfPasswordError } from "@/services/reconciliation/pdf-parser";
import { buildArthPool, matchStatementRows } from "@/services/reconciliation/statement-matcher";
import { settingsStorage } from "@/services/storage";
import {
  createVaultEntry,
  getStatementPasswordForAccount,
  type VaultEntry,
} from "@/services/vault";
import type { AlertButton } from "@/hooks/use-alert";

const ACCOUNT_SUFFIX_MAP_KEY = "recon_account_suffix_map";

function getSavedSuffixMap(): Record<string, string> {
  try {
    const raw = settingsStorage.getString(ACCOUNT_SUFFIX_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSuffixMapping(suffix: string, accountId: string): void {
  const map = getSavedSuffixMap();
  map[suffix] = accountId;
  settingsStorage.set(ACCOUNT_SUFFIX_MAP_KEY, JSON.stringify(map));
}

type Step = "account" | "file" | "matching" | "done";

export default function NewReconciliationScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent } = useColorScheme();

  const params = useLocalSearchParams<{ prefill_account_id?: string }>();

  const [step, setStep] = useState<Step>(params.prefill_account_id ? "file" : "account");
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    params.prefill_account_id ?? null,
  );
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [mismatchWarning, setMismatchWarning] = useState<string | null>(null);
  const [matchingAccount, setMatchingAccount] = useState(false);
  const [progress, setProgress] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // PDF password prompt state
  const [pdfPasswordVisible, setPdfPasswordVisible] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [pdfPasswordError, setPdfPasswordError] = useState("");
  const pendingPdfRef = useRef<{ uri: string; name: string } | null>(null);

  // XLS/XLSX password prompt state
  const [xlsPasswordVisible, setXlsPasswordVisible] = useState(false);
  const [xlsPassword, setXlsPassword] = useState("");
  const [xlsPasswordError, setXlsPasswordError] = useState("");
  const pendingXlsRef = useRef<{ buffer: ArrayBuffer; name: string } | null>(null);

  useEffect(() => {
    getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch(() => {});
  }, []);

  const applyParsed = useCallback((p: ParsedStatement, name: string) => {
    setParsed(p);
    setFilename(name);

    if (p.detectedAccountSuffix && selectedAccountId) {
      const account = accounts.find((a) => a.id === selectedAccountId);
      const ident = account?.account_identifier ?? "";
      if (!ident.includes(p.detectedAccountSuffix) && !p.detectedAccountSuffix.includes(ident)) {
        setMismatchWarning(
          `This statement appears to be for account ****${p.detectedAccountSuffix}` +
          (account
            ? `, but you selected "${account.account_label || account.bank_name}" (identifier: ${ident || "not set"}).`
            : ".") +
          " Please confirm this is the right account.",
        );
      } else {
        setMismatchWarning(null);
      }
    }

    setStep("file");
  }, [selectedAccountId, accounts]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/pdf",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.name ?? "statement";
      const nameLower = name.toLowerCase();

      if (nameLower.endsWith(".xls") || nameLower.endsWith(".xlsx")) {
        const fileObj = new File(asset.uri);
        const bytes = await fileObj.bytes();
        const buffer = bytes.buffer as ArrayBuffer;
        try {
          const p = parseXlsFile(buffer, name);
          applyParsed(p, name);
        } catch (e) {
          if (e instanceof XlsPasswordError) {
            pendingXlsRef.current = { buffer, name };
            setXlsPassword("");
            setXlsPasswordError("");
            setXlsPasswordVisible(true);
          } else {
            alert(
              "Couldn't read file",
              e instanceof ParseError ? e.message : "An unexpected error occurred while reading the file.",
            );
          }
        }
        return;
      }

      if (nameLower.endsWith(".pdf")) {
        try {
          const p = await parsePdfStatement(asset.uri, name);
          applyParsed(p, name);
        } catch (e) {
          if (e instanceof PdfPasswordError) {
            pendingPdfRef.current = { uri: asset.uri, name };

            // Check vault for a saved statement password linked to this account
            if (selectedAccountId) {
              const savedPwd = await getStatementPasswordForAccount(selectedAccountId).catch(() => null);
              if (savedPwd) {
                const buttons: AlertButton[] = [
                    {
                      text: "Use saved password",
                      onPress: async () => {
                        try {
                          const p2 = await parsePdfStatement(asset.uri, name, savedPwd);
                          pendingPdfRef.current = null;
                          applyParsed(p2, name);
                        } catch (err) {
                          if (err instanceof PdfPasswordError) {
                            // Saved password is wrong — fall back to manual
                            setPdfPassword("");
                            setPdfPasswordError("Saved password didn't work. Enter it manually.");
                            setPdfPasswordVisible(true);
                          } else if (err instanceof ParseError) {
                            alert("Couldn't read PDF", (err as Error).message);
                          }
                        }
                      },
                    },
                    {
                      text: "Enter manually",
                      style: "cancel" as const,
                      onPress: () => {
                        setPdfPassword("");
                        setPdfPasswordError("");
                        setPdfPasswordVisible(true);
                      },
                    },
                  ];
                  alert(
                    "Use saved password?",
                    `A statement password for this account is saved in your vault. Use it?`,
                    buttons,
                  );
                  return;
              }
            }

            // No saved password — show manual prompt
            setPdfPassword("");
            setPdfPasswordError("");
            setPdfPasswordVisible(true);
          } else if (e instanceof ParseError) {
            alert("Couldn't read PDF", (e as Error).message);
          } else {
            alert("Couldn't read PDF", "An unexpected error occurred. Please try exporting the statement again.");
          }
        }
        return;
      }

      alert(
        "Unsupported format",
        "Please upload an XLS, XLSX, or PDF bank statement.",
      );
    } catch (e) {
      alert("Error", "Could not open the file picker.");
    }
  }, [selectedAccountId, accounts, alert, applyParsed]);

  const offerSavePasswordToVault = useCallback((pwd: string, name: string) => {
    if (!selectedAccountId) return;
    const buttons: AlertButton[] = [
      {
        text: "Save to vault",
        onPress: async () => {
          try {
            await createVaultEntry({
              title: `${name} Statement Password`,
              category: "statement_pwd",
              login_method: "password",
              password: pwd,
              linked_account_id: selectedAccountId,
            });
          } catch {
            // Best-effort — silent failure is fine
          }
        },
      },
      { text: "Not now", style: "cancel" as const },
    ];
    alert(
      "Save password to vault?",
      "Store this statement password in your vault so Arth can auto-fill it next time.",
      buttons,
    );
  }, [selectedAccountId, alert]);

  const handlePdfPasswordSubmit = useCallback(async () => {
    const pending = pendingPdfRef.current;
    if (!pending) return;
    setPdfPasswordError("");

    try {
      const p = await parsePdfStatement(pending.uri, pending.name, pdfPassword);
      setPdfPasswordVisible(false);
      pendingPdfRef.current = null;
      applyParsed(p, pending.name);
      // Offer to save the successful password to vault (for future auto-fill)
      offerSavePasswordToVault(pdfPassword, p.detectedBank ?? pending.name);
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPdfPasswordError(e.message);
      } else if (e instanceof ParseError) {
        setPdfPasswordVisible(false);
        pendingPdfRef.current = null;
        alert("Couldn't read PDF", (e as Error).message);
      } else {
        setPdfPasswordVisible(false);
        pendingPdfRef.current = null;
        alert("Error", "An unexpected error occurred.");
      }
    }
  }, [pdfPassword, applyParsed, alert, offerSavePasswordToVault]);

  const handleXlsPasswordSubmit = useCallback(() => {
    const pending = pendingXlsRef.current;
    if (!pending) return;
    setXlsPasswordError("");
    try {
      const p = parseXlsFile(pending.buffer, pending.name, xlsPassword);
      setXlsPasswordVisible(false);
      pendingXlsRef.current = null;
      applyParsed(p, pending.name);
    } catch (e) {
      if (e instanceof XlsPasswordError) {
        setXlsPasswordError(e.message);
      } else if (e instanceof ParseError) {
        setXlsPasswordVisible(false);
        pendingXlsRef.current = null;
        alert("Couldn't read file", (e as Error).message);
      } else {
        setXlsPasswordVisible(false);
        pendingXlsRef.current = null;
        alert("Error", "An unexpected error occurred.");
      }
    }
  }, [xlsPassword, applyParsed, alert]);

  const handleStartMatching = useCallback(async () => {
    if (!selectedAccountId || !parsed) return;

    // Duplicate session check
    if (parsed.startDate && parsed.endDate) {
      const existing = await findExistingSession(
        selectedAccountId,
        parsed.startDate,
        parsed.endDate,
      );
      if (existing) {
        alert(
          "Session already exists",
          `A reconciliation for this account and period already exists (${existing.status}). Do you want to resume it?`,
          [
            { text: "Resume", onPress: () => router.replace(`/settings/reconciliation/${existing.id}`) },
            { text: "Start new anyway", onPress: () => runMatching() },
            { text: "Cancel", style: "cancel" },
          ],
        );
        return;
      }
    }

    runMatching();
  }, [selectedAccountId, parsed, alert, router]);

  const runMatching = useCallback(async () => {
    if (!selectedAccountId || !parsed) return;

    // Save suffix mapping for future imports
    if (parsed.detectedAccountSuffix) {
      saveSuffixMapping(parsed.detectedAccountSuffix, selectedAccountId);
    }

    setMatchingAccount(true);
    setStep("matching");

    try {
      setProgress(`Reading ${parsed.rows.length} statement transactions…`);
      const pool = await buildArthPool(
        selectedAccountId,
        parsed.startDate ?? "2000-01-01",
        parsed.endDate ?? new Date().toISOString().slice(0, 10),
      );

      setProgress("Matching against your Arth ledger…");
      const { results, extraInArth } = matchStatementRows(
        parsed.rows,
        pool,
        parsed.startDate ?? undefined,
        parsed.endDate ?? undefined,
      );

      const matched = results.filter((r) => r.matched !== null);
      setProgress(`Matched ${matched.length} of ${results.length}. Saving…`);

      const sid = await createSession({
        account_id: selectedAccountId,
        stmt_start_date: parsed.startDate ?? "",
        stmt_end_date: parsed.endDate ?? "",
        stmt_closing_bal: parsed.closingBalance ?? undefined,
        import_format: parsed.format,
        import_filename: filename ?? undefined,
      });

      // Insert statement items
      await bulkInsertItems(
        sid,
        results.map((r, i) => ({
          stmt_date: r.stmtRow.date,
          stmt_amount: r.stmtRow.amount,
          stmt_direction: r.stmtRow.direction,
          stmt_narration: r.stmtRow.narration,
          matched_expense_id: r.matched?.kind === "expense" ? r.matched.id : undefined,
          matched_transfer_id: r.matched?.kind === "transfer" ? r.matched.id : undefined,
          match_confidence: r.confidence ?? undefined,
          status: r.matched ? "matched" : "unmatched",
          sort_order: i,
        })),
      );

      await updateSession(sid, {
        total_stmt_count: results.length,
        matched_count: matched.length,
      });

      setSessionId(sid);
      setStep("done");
    } catch (e) {
      alert("Error", "Something went wrong while matching. Please try again.");
      setStep("file");
    } finally {
      setMatchingAccount(false);
    }
  }, [selectedAccountId, parsed, filename, alert]);

  // ─── Render steps ──────────────────────────────────────────────────────────

  if (step === "matching") {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={accent[500]} />
          <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mt-5 text-center">
            Matching transactions…
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2 text-center">
            {progress}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  useEffect(() => {
    if (step === "done" && sessionId) {
      router.replace(`/settings/reconciliation/${sessionId}`);
    }
  }, [step, sessionId, router]);

  // ─── Password modals (shared between steps) ────────────────────────────────

  const passwordModals = (
    <>
      <Modal
        visible={pdfPasswordVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setPdfPasswordVisible(false); pendingPdfRef.current = null; }}
      >
        <View className="flex-1 justify-center items-center px-8" style={{ backgroundColor: "#00000066" }}>
          <View className="w-full rounded-2xl p-6" style={{ backgroundColor: colors.surface }}>
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary mb-1">
              Password-protected PDF
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4">
              Enter the password to unlock this statement.
            </Text>
            <TextInput
              value={pdfPassword}
              onChangeText={setPdfPassword}
              secureTextEntry
              placeholder="Statement password"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="done"
              onSubmitEditing={handlePdfPasswordSubmit}
              className="border rounded-xl px-4 py-3 text-base text-text-primary dark:text-text-dark-primary mb-2"
              style={{ borderColor: pdfPasswordError ? "#EF4444" : colors.border }}
              autoFocus
            />
            {pdfPasswordError ? (
              <Text className="text-xs text-red-500 mb-2">{pdfPasswordError}</Text>
            ) : null}
            <View className="flex-row gap-3 mt-2">
              <Pressable
                onPress={() => { setPdfPasswordVisible(false); pendingPdfRef.current = null; }}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: colors.border + "55" }}
              >
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handlePdfPasswordSubmit}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: accent[500] }}
              >
                <Text className="text-sm font-semibold text-white">Unlock</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={xlsPasswordVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setXlsPasswordVisible(false); pendingXlsRef.current = null; }}
      >
        <View className="flex-1 justify-center items-center px-8" style={{ backgroundColor: "#00000066" }}>
          <View className="w-full rounded-2xl p-6" style={{ backgroundColor: colors.surface }}>
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary mb-1">
              Password-protected file
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-4">
              Enter the password to unlock this Excel statement.
            </Text>
            <TextInput
              value={xlsPassword}
              onChangeText={setXlsPassword}
              secureTextEntry
              placeholder="File password"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="done"
              onSubmitEditing={handleXlsPasswordSubmit}
              className="border rounded-xl px-4 py-3 text-base text-text-primary dark:text-text-dark-primary mb-2"
              style={{ borderColor: xlsPasswordError ? "#EF4444" : colors.border }}
              autoFocus
            />
            {xlsPasswordError ? (
              <Text className="text-xs text-red-500 mb-2">{xlsPasswordError}</Text>
            ) : null}
            <View className="flex-row gap-3 mt-2">
              <Pressable
                onPress={() => { setXlsPasswordVisible(false); pendingXlsRef.current = null; }}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: colors.border + "55" }}
              >
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleXlsPasswordSubmit}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: accent[500] }}
              >
                <Text className="text-sm font-semibold text-white">Unlock</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );

  // ─── Step: account ────────────────────────────────────────────────────────

  if (step === "account") {
    return (
      <ScreenContainer padTop={false}>
        <View className="px-4 pt-5 pb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-1">
            Step 1 of 2
          </Text>
          <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary">
            Which account?
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1">
            Select the account this statement belongs to.
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          <Card className="mb-4">
            {accounts.map((acc, i) => (
              <Pressable
                key={acc.id}
                onPress={() => {
                  setSelectedAccountId(acc.id);
                  setMismatchWarning(null);
                  setParsed(null);
                  setFilename(null);
                  setStep("file");
                }}
                className={`flex-row items-center py-3.5 ${i < accounts.length - 1 ? "border-b border-border-light dark:border-border-dark" : ""}`}
              >
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                    {acc.account_label || acc.bank_name}
                  </Text>
                  {acc.account_identifier && (
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      ****{acc.account_identifier}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            ))}
          </Card>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ─── Step: file ───────────────────────────────────────────────────────────

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <ScreenContainer padTop={false}>
      {passwordModals}

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>

        {/* Step header + selected account */}
        <View className="pt-5 pb-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-1">
            Step 2 of 2
          </Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary">
              Import statement
            </Text>
            <Pressable
              onPress={() => setStep("account")}
              className="flex-row items-center"
            >
              <Ionicons name="swap-horizontal-outline" size={14} color={accent[500]} />
              <Text className="text-xs font-semibold ml-1" style={{ color: accent[500] }}>
                Change account
              </Text>
            </Pressable>
          </View>
          {selectedAccount && (
            <View
              className="mt-2 flex-row items-center px-3 py-2 rounded-xl self-start"
              style={{ backgroundColor: accent[500] + "18" }}
            >
              <Ionicons name="wallet-outline" size={13} color={accent[600]} />
              <Text className="text-xs font-semibold ml-1.5" style={{ color: accent[700] }}>
                {selectedAccount.account_label || selectedAccount.bank_name}
                {selectedAccount.account_identifier ? ` ····${selectedAccount.account_identifier}` : ""}
              </Text>
            </View>
          )}
        </View>

        {/* File upload zone */}
        <Pressable
          onPress={handlePickFile}
          className="border-2 border-dashed rounded-2xl py-10 items-center mb-3"
          style={{ borderColor: accent[500] }}
        >
          <Ionicons name="cloud-upload-outline" size={36} color={accent[500]} />
          <Text className="text-sm font-semibold mt-2" style={{ color: accent[500] }}>
            {filename ?? "Upload XLS, XLSX, or PDF"}
          </Text>
          <Text className="text-xs text-text-tertiary mt-1">
            Digital statements only — scanned images not supported
          </Text>
        </Pressable>

        {/* Mismatch warning */}
        {mismatchWarning && (
          <View className="mb-3 px-4 py-3 rounded-xl flex-row items-start" style={{ backgroundColor: "#F59E0B22" }}>
            <Ionicons name="warning-outline" size={18} color="#F59E0B" />
            <Text className="text-xs text-text-primary dark:text-text-dark-primary ml-2 flex-1">
              {mismatchWarning}
            </Text>
          </View>
        )}

        {/* Parsed summary */}
        {parsed && (
          <Card className="mb-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name="document-text-outline" size={18} color={accent[500]} />
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary ml-2 flex-1" numberOfLines={1}>
                {filename}
              </Text>
            </View>
            {parsed.detectedBank && (
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Bank: {parsed.detectedBank}
                {parsed.detectedAccountSuffix ? ` · ****${parsed.detectedAccountSuffix}` : ""}
              </Text>
            )}
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {parsed.rows.length} transactions
              {parsed.startDate && parsed.endDate
                ? ` · ${parsed.startDate} to ${parsed.endDate}`
                : ""}
            </Text>
            {parsed.closingBalance !== null && (
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                Closing balance: ₹{parsed.closingBalance.toLocaleString("en-IN")}
              </Text>
            )}
          </Card>
        )}
      </ScrollView>

      {/* Pinned bottom button */}
      <View
        className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3"
        style={{ backgroundColor: colors.background }}
      >
        <Pressable
          onPress={handleStartMatching}
          disabled={!parsed}
          className="py-4 rounded-2xl items-center"
          style={{ backgroundColor: parsed ? accent[500] : colors.border, opacity: parsed ? 1 : 0.5 }}
        >
          <Text className="text-base font-semibold text-white">
            Start Matching
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
