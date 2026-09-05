import { Card, ScreenContainer, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  AVAILABLE_MODELS,
  cancelDownload,
  deleteModel,
  downloadModel,
  getActiveModelId,
  getLastInitError,
  getModelNativePath,
  getModelSizeOnDisk,
  isAIDataAccountsEnabled,
  isAIDataBudgetEnabled,
  isAIDataExpensesEnabled,
  isAIDataHisaabEnabled,
  isAIDataVaultEnabled,
  isArthAIEnabled,
  isModelDownloaded,
  isNLSearchEnabled,
  setAIDataAccountsEnabled,
  setAIDataBudgetEnabled,
  setAIDataExpensesEnabled,
  setAIDataHisaabEnabled,
  setAIDataVaultEnabled,
  setActiveModelId as setActiveModelService,
  setArthAIEnabled,
  setNLSearchEnabled,
  type ModelDefinition,
} from "@/services/ai-assistant";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";

type Phase = "idle" | "downloading" | "cancelling";

interface ModelState {
  downloaded: boolean;
  sizeMB: number;
  phase: Phase;
  downloadedMB: number;
  totalMB: number;
  pct: number;
}

function makeDefaultState(model: ModelDefinition): ModelState {
  return { downloaded: false, sizeMB: 0, phase: "idle", downloadedMB: 0, totalMB: model.sizeMB, pct: 0 };
}

export default function AIAssistantSettings() {
  const { colors, accent, colorScheme } = useColorScheme();
  const alert = useAlert();

  const [aiEnabled, setAiEnabled] = useState(isArthAIEnabled);
  const [nlSearchEnabled, setNlSearchEnabled] = useState(isNLSearchEnabled);
  const [activeModelId, setActiveModelId] = useState(getActiveModelId);
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>(() =>
    Object.fromEntries(AVAILABLE_MODELS.map((m) => [m.id, makeDefaultState(m)])),
  );
  const [initError, setInitError] = useState<string | undefined>(undefined);
  const [modelPath, setModelPath] = useState("");

  const [dataExpenses, setDataExpenses] = useState(isAIDataExpensesEnabled);
  const [dataAccounts, setDataAccounts] = useState(isAIDataAccountsEnabled);
  const [dataBudget, setDataBudget] = useState(isAIDataBudgetEnabled);
  const [dataHisaab, setDataHisaab] = useState(isAIDataHisaabEnabled);
  const [dataVault, setDataVault] = useState(isAIDataVaultEnabled);

  const isMounted = useRef(true);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      setActiveModelId(getActiveModelId());
      (async () => {
        const updates: Record<string, Partial<ModelState>> = {};
        for (const m of AVAILABLE_MODELS) {
          const downloaded = await isModelDownloaded(m.id);
          const sizeMB = downloaded ? await getModelSizeOnDisk(m.id) : 0;
          updates[m.id] = { downloaded, sizeMB };
        }
        if (!isMounted.current) return;
        setModelStates((prev) => {
          const next = { ...prev };
          for (const id in updates) {
            // Don't overwrite an in-progress download state
            if (next[id].phase === "idle") {
              next[id] = { ...next[id], ...updates[id] };
            }
          }
          return next;
        });
        setInitError(getLastInitError());
        setModelPath(getModelNativePath());
      })();
      return () => { isMounted.current = false; };
    }, []),
  );

  const patchModel = useCallback((id: string, patch: Partial<ModelState>) => {
    setModelStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // ── Handlers ────────────────────────────────────────────────────

  const handleAIToggle = useCallback(
    (enable: boolean) => {
      if (enable) {
        alert(
          "Enable Arth AI",
          "The AI assistant runs fully on-device — your data never leaves your phone.\n\nA one-time model download is required on first use. Wi-Fi recommended.\n\nIf the app slows down or crashes, you can disable Arth AI here at any time.",
          [
            { text: "Not Now", style: "cancel" },
            { text: "Enable", onPress: () => { setArthAIEnabled(true); setAiEnabled(true); } },
          ],
        );
      } else {
        setArthAIEnabled(false);
        setAiEnabled(false);
      }
    },
    [alert],
  );

  const handleDownload = useCallback(
    async (modelId: string) => {
      patchModel(modelId, { phase: "downloading", downloadedMB: 0, pct: 0 });
      try {
        await downloadModel(modelId, (dlMB, totMB, pct) => {
          if (!isMounted.current) return;
          patchModel(modelId, { downloadedMB: dlMB, totalMB: totMB, pct });
        });
        if (!isMounted.current) return;
        const sizeMB = await getModelSizeOnDisk(modelId);
        patchModel(modelId, { downloaded: true, sizeMB, phase: "idle" });
        // Auto-activate after download
        setActiveModelService(modelId);
        setActiveModelId(modelId);
      } catch (e) {
        if (!isMounted.current) return;
        patchModel(modelId, { phase: "idle", downloadedMB: 0, pct: 0 });
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("cancel")) {
          alert("Download failed", "Could not download the model. Check your internet connection and try again.");
        }
      }
    },
    [alert, patchModel],
  );

  const handleCancel = useCallback(
    async (modelId: string) => {
      patchModel(modelId, { phase: "cancelling" });
      await cancelDownload();
      if (!isMounted.current) return;
      patchModel(modelId, { phase: "idle", downloadedMB: 0, pct: 0 });
    },
    [patchModel],
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      const model = AVAILABLE_MODELS.find((m) => m.id === modelId)!;
      const sizeMB = modelStates[modelId]?.sizeMB || model.sizeMB;
      alert(
        `Delete ${model.name}?`,
        `This removes the model file and frees ~${sizeMB} MB of storage. You can re-download it any time.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteModel(modelId);
              if (!isMounted.current) return;
              patchModel(modelId, { downloaded: false, sizeMB: 0 });
              // If deleted model was active, fall back to whatever is still downloaded
              if (activeModelId === modelId) {
                const fallback = AVAILABLE_MODELS.find(
                  (m) => m.id !== modelId && modelStates[m.id]?.downloaded,
                );
                const nextId = fallback?.id ?? "1b";
                setActiveModelService(nextId);
                setActiveModelId(nextId);
              }
            },
          },
        ],
      );
    },
    [alert, modelStates, activeModelId, patchModel],
  );

  const handleUseModel = useCallback((modelId: string) => {
    setActiveModelService(modelId);
    setActiveModelId(modelId);
  }, []);

  // ── Render helpers ────────────────────────────────────────────
  const isDark = colorScheme === "dark";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 py-4">

          {/* Feature toggle */}
          <Card title="Arth AI (Beta)" className="mb-4">
            <View className="flex-row items-center justify-between py-2 border-b border-border">
              <View className="flex-1 mr-3">
                <Text className="text-base text-foreground">
                  Enable AI assistant
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Runs fully on-device. No data ever leaves your phone.
                </Text>
              </View>
              <Switch
                value={aiEnabled}
                onValueChange={handleAIToggle}
                trackColor={{ false: colors.border, true: accent[500] }}
                thumbColor="#FFFFFF"
              />
            </View>
            {!aiEnabled && (
              <Text className="text-xs text-faint-foreground mt-3">
                Enable to chat with your personal finance data. Choose and download a model below.
              </Text>
            )}
          </Card>

          {aiEnabled && (
            <>
              {/* RAM warning */}
              <View
                className="mb-4 px-4 py-3 rounded-xl border-l-4"
                style={{ backgroundColor: isDark ? "#2e1f05" : "#fffbeb", borderLeftColor: "#d29922" }}
              >
                <View className="flex-row items-start gap-2">
                  <Ionicons name="warning-outline" size={16} color="#d29922" style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-xs leading-5" style={{ color: "#d29922" }}>
                    The AI model loads into RAM while in use. If the app slows down or crashes, disable Arth AI or switch to a smaller model.
                  </Text>
                </View>
              </View>

              {/* Model cards */}
              <Card title="AI Model" className="mb-4">
                <Text className="text-xs text-muted-foreground mb-3">
                  Download one or both models. The active model is used in chat.
                </Text>
                {AVAILABLE_MODELS.map((model, idx) => {
                  const state = modelStates[model.id] ?? makeDefaultState(model);
                  const isActive = activeModelId === model.id;
                  const isDownloading = state.phase === "downloading";
                  const isCancelling = state.phase === "cancelling";
                  const pctLabel = `${Math.round(state.pct * 100)}%`;
                  const isLast = idx === AVAILABLE_MODELS.length - 1;

                  return (
                    <View
                      key={model.id}
                      className={`py-3 ${!isLast ? "border-b border-border" : ""}`}
                    >
                      {/* Header row */}
                      <View className="flex-row items-start justify-between mb-1">
                        <View className="flex-1 mr-2">
                          <Text className="text-sm font-semibold text-foreground">
                            {model.name}
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {model.description}
                          </Text>
                        </View>
                        {/* Status badge */}
                        {isActive && state.downloaded ? (
                          <View
                            className="px-2 py-0.5 rounded-full flex-row items-center gap-1"
                            style={{ backgroundColor: isDark ? "#0f2a18" : "#dcfce7" }}
                          >
                            <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#3fb950" }} />
                            <Text className="text-xs font-semibold" style={{ color: "#3fb950" }}>Active</Text>
                          </View>
                        ) : state.downloaded ? (
                          <View
                            className="px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: isDark ? "#1c2128" : "#f3f4f6" }}
                          >
                            <Text className="text-xs font-medium text-muted-foreground">
                              Downloaded
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Size tag */}
                      <Text className="text-xs text-faint-foreground mb-2">
                        ~{model.sizeMB >= 1000
                          ? `${(model.sizeMB / 1024).toFixed(1)} GB`
                          : `${model.sizeMB} MB`} · {model.minRAMGB} GB+ RAM required
                      </Text>

                      {/* Download progress */}
                      {(isDownloading || isCancelling) && (
                        <View className="mb-2">
                          <View className="flex-row justify-between mb-1">
                            <Text className="text-xs text-muted-foreground">
                              {state.downloadedMB} MB of {state.totalMB} MB
                            </Text>
                            <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                              {pctLabel}
                            </Text>
                          </View>
                          <View className="h-1.5 rounded-full bg-border overflow-hidden">
                            <View
                              className="h-full rounded-full"
                              style={{ width: `${Math.round(state.pct * 100)}%`, backgroundColor: accent[500] }}
                            />
                          </View>
                        </View>
                      )}

                      {/* Action buttons */}
                      <View className="flex-row gap-2 mt-1">
                        {/* Download / Cancel */}
                        {!state.downloaded && (isDownloading || isCancelling) && (
                          <Pressable
                            onPress={() => handleCancel(model.id)}
                            disabled={isCancelling}
                            className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border"
                          >
                            {isCancelling ? (
                              <ActivityIndicator size="small" color={colors.textSecondary} />
                            ) : (
                              <Text className="text-sm text-muted-foreground">
                                Cancel
                              </Text>
                            )}
                          </Pressable>
                        )}

                        {!state.downloaded && state.phase === "idle" && (
                          <Pressable
                            onPress={() => handleDownload(model.id)}
                            className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg gap-1.5"
                            style={{ backgroundColor: accent[500] }}
                          >
                            <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                            <Text className="text-sm font-semibold text-white">
                              Download (~{model.sizeMB >= 1000
                                ? `${(model.sizeMB / 1024).toFixed(1)} GB`
                                : `${model.sizeMB} MB`})
                            </Text>
                          </Pressable>
                        )}

                        {/* Use this model (downloaded but not active) */}
                        {state.downloaded && !isActive && (
                          <Pressable
                            onPress={() => handleUseModel(model.id)}
                            className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg gap-1.5"
                            style={{ backgroundColor: accent[500] }}
                          >
                            <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                            <Text className="text-sm font-semibold text-white">Use this model</Text>
                          </Pressable>
                        )}

                        {/* Active model placeholder — no button needed */}
                        {state.downloaded && isActive && (
                          <View className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg gap-1.5"
                            style={{ backgroundColor: isDark ? "#0f2a18" : "#dcfce7" }}>
                            <Ionicons name="checkmark-circle" size={16} color="#3fb950" />
                            <Text className="text-sm font-semibold" style={{ color: "#3fb950" }}>Currently active</Text>
                          </View>
                        )}

                        {/* Delete */}
                        {state.downloaded && (
                          <Pressable
                            onPress={() => handleDelete(model.id)}
                            className="w-10 h-10 items-center justify-center rounded-lg border border-border"
                          >
                            <Ionicons name="trash-outline" size={18} color="#f85149" />
                          </Pressable>
                        )}
                      </View>

                      {/* 3B RAM caution */}
                      {model.id === "3b" && state.downloaded && (
                        <Text className="text-xs text-faint-foreground mt-2">
                          If the app is slow or unresponsive, delete the 3B model and use 1B instead.
                        </Text>
                      )}
                    </View>
                  );
                })}
              </Card>

              {/* Debug info */}
              {(initError || modelPath) && (
                <Card title="Debug Info" className="mb-4">
                  <View className="py-2">
                    <Text className="text-xs text-muted-foreground mb-1">Active model path:</Text>
                    <Text
                      className="text-xs font-mono"
                      style={{ color: initError ? "#f85149" : "#3fb950" }}
                      selectable
                    >
                      {modelPath || "—"}
                    </Text>
                    {initError && (
                      <>
                        <Text className="text-xs text-muted-foreground mt-3 mb-1">Init error:</Text>
                        <Text className="text-xs text-danger" selectable>{initError}</Text>
                      </>
                    )}
                  </View>
                </Card>
              )}

              {/* Data access toggles */}
              <Card title="Data Access" className="mb-4">
                <Text className="text-xs text-muted-foreground mb-3">
                  Choose what data the AI assistant can see. All processing stays on-device.
                </Text>

                {[
                  {
                    label: "Expenses & Transactions",
                    sub: "Monthly totals, top categories, transaction counts",
                    val: dataExpenses,
                    set: (v: boolean) => { setAIDataExpensesEnabled(v); setDataExpenses(v); },
                  },
                  {
                    label: "Accounts & Balances",
                    sub: "Account names, balances, credit utilization",
                    val: dataAccounts,
                    set: (v: boolean) => { setAIDataAccountsEnabled(v); setDataAccounts(v); },
                  },
                  {
                    label: "Budget",
                    sub: "Budget limits vs actual spending per category",
                    val: dataBudget,
                    set: (v: boolean) => { setAIDataBudgetEnabled(v); setDataBudget(v); },
                  },
                  {
                    label: "Hisaab (Family Ledger)",
                    sub: "Who owes what, net balances",
                    val: dataHisaab,
                    set: (v: boolean) => { setAIDataHisaabEnabled(v); setDataHisaab(v); },
                  },
                  {
                    label: "Vault (Passwords & Logins)",
                    sub: "Entry titles and renewal dates only — passwords are never shared with the AI",
                    val: dataVault,
                    set: (v: boolean) => { setAIDataVaultEnabled(v); setDataVault(v); },
                  },
                ].map((row, idx, arr) => (
                  <View
                    key={row.label}
                    className={`flex-row items-center justify-between py-2.5 ${idx < arr.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-sm text-foreground">{row.label}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">{row.sub}</Text>
                    </View>
                    <Switch
                      value={row.val}
                      onValueChange={row.set}
                      trackColor={{ false: colors.border, true: accent[500] }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* Natural language search — independent of model */}
          <Card title="Natural Language Search" className="mb-4">
            <View className="flex-row items-center justify-between py-2">
              <View className="flex-1 mr-3">
                <Text className="text-base text-foreground">
                  Smart search
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Search Transactions with phrases like "food expenses last month". Rule-based — works without a model download.
                </Text>
              </View>
              <Switch
                value={nlSearchEnabled}
                onValueChange={(v) => { setNLSearchEnabled(v); setNlSearchEnabled(v); }}
                trackColor={{ false: colors.border, true: accent[500] }}
                thumbColor="#FFFFFF"
              />
            </View>
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
