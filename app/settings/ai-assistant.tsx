import { Card, ScreenContainer } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  getLastInitError,
  getModelNativePath,
  getModelSizeOnDisk,
  isArthAIEnabled,
  isModelDownloaded,
  isNLSearchEnabled,
  MODEL_SIZE_MB,
  setArthAIEnabled,
  setNLSearchEnabled,
} from "@/services/ai-assistant";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";

type DownloadState = "idle" | "downloading" | "cancelling";

export default function AIAssistantSettings() {
  const { colors, accent, colorScheme } = useColorScheme();
  const alert = useAlert();

  const [aiEnabled, setAiEnabled] = useState(isArthAIEnabled);
  const [nlSearchEnabled, setNlSearchEnabled] = useState(isNLSearchEnabled);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [modelSizeMB, setModelSizeMB] = useState(0);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadedMB, setDownloadedMB] = useState(0);
  const [totalMB, setTotalMB] = useState(MODEL_SIZE_MB);
  const [downloadPct, setDownloadPct] = useState(0);
  const [initError, setInitError] = useState<string | undefined>(undefined);
  const [modelPath, setModelPath] = useState<string>("");

  const isMounted = useRef(true);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      (async () => {
        const downloaded = await isModelDownloaded();
        const sizeMB = downloaded ? await getModelSizeOnDisk() : 0;
        if (isMounted.current) {
          setModelDownloaded(downloaded);
          setModelSizeMB(sizeMB);
          setInitError(getLastInitError());
          setModelPath(getModelNativePath());
        }
      })();
      return () => { isMounted.current = false; };
    }, []),
  );

  const handleAIToggle = useCallback(
    (enable: boolean) => {
      if (enable) {
        alert(
          "Enable Arth AI",
          "The AI assistant runs fully on-device — your data never leaves your phone.\n\nA one-time download of ~880 MB is required on first use. Wi-Fi recommended.\n\nIf the app slows down or crashes, you can disable Arth AI here at any time.",
          [
            { text: "Not Now", style: "cancel" },
            {
              text: "Enable",
              onPress: () => {
                setArthAIEnabled(true);
                setAiEnabled(true);
              },
            },
          ],
        );
      } else {
        setArthAIEnabled(false);
        setAiEnabled(false);
      }
    },
    [alert],
  );

  const handleNLSearchToggle = useCallback((enable: boolean) => {
    setNLSearchEnabled(enable);
    setNlSearchEnabled(enable);
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloadState("downloading");
    setDownloadedMB(0);
    setDownloadPct(0);
    try {
      await downloadModel((dlMB, totMB, pct) => {
        if (!isMounted.current) return;
        setDownloadedMB(dlMB);
        setTotalMB(totMB);
        setDownloadPct(pct);
      });
      if (!isMounted.current) return;
      const sizeMB = await getModelSizeOnDisk();
      setModelDownloaded(true);
      setModelSizeMB(sizeMB);
      setDownloadState("idle");
    } catch (e) {
      if (!isMounted.current) return;
      setDownloadState("idle");
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("cancel")) {
        alert("Download failed", "Could not download the model. Check your internet connection and try again.");
      }
    }
  }, [alert]);

  const handleCancelDownload = useCallback(async () => {
    setDownloadState("cancelling");
    await cancelDownload();
    if (!isMounted.current) return;
    setDownloadState("idle");
    setDownloadedMB(0);
    setDownloadPct(0);
  }, []);

  const handleDeleteModel = useCallback(() => {
    alert(
      "Delete model",
      `This will remove the AI model from your phone and free ~${modelSizeMB || MODEL_SIZE_MB} MB of storage. You can re-download it any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteModel();
            if (!isMounted.current) return;
            setModelDownloaded(false);
            setModelSizeMB(0);
          },
        },
      ],
    );
  }, [alert, modelSizeMB]);

  const pctLabel = `${Math.round(downloadPct * 100)}%`;

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
            <View className="flex-row items-center justify-between py-2 border-b border-border-light dark:border-border-dark">
              <View className="flex-1 mr-3">
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  Enable AI assistant
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
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
              <Text className="text-xs text-text-tertiary mt-3">
                Enable to chat with your personal finance data. Requires a one-time ~880 MB model download.
              </Text>
            )}
          </Card>

          {/* RAM warning — always visible when enabled */}
          {aiEnabled && (
            <View
              className="mb-4 px-4 py-3 rounded-xl border-l-4"
              style={{
                backgroundColor: colorScheme === "dark" ? "#2e1f05" : "#fffbeb",
                borderLeftColor: "#d29922",
              }}
            >
              <View className="flex-row items-start gap-2">
                <Ionicons name="warning-outline" size={16} color="#d29922" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-xs leading-5" style={{ color: "#d29922" }}>
                  Needs at least 3 GB free RAM. If the app slows down or crashes after enabling, disable Arth AI here.
                </Text>
              </View>
            </View>
          )}

          {/* Model section */}
          {aiEnabled && (
            <Card title="AI Model" className="mb-4">
              <View className="py-2 border-b border-border-light dark:border-border-dark">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 mr-3">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      Llama 3.2 1B Instruct
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      Q4_K_M quantization · ~880 MB
                    </Text>
                  </View>
                  <View
                    className="px-2 py-1 rounded"
                    style={{
                      backgroundColor: modelDownloaded
                        ? colorScheme === "dark" ? "#0f2a18" : "#dcfce7"
                        : colorScheme === "dark" ? "#1a3d3a" : "#f0fdf4",
                    }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: modelDownloaded ? "#3fb950" : accent[500] }}
                    >
                      {modelDownloaded ? "Downloaded" : "Not downloaded"}
                    </Text>
                  </View>
                </View>

                {/* Download progress */}
                {(downloadState === "downloading" || downloadState === "cancelling") && (
                  <View className="mt-3">
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        {downloadedMB} MB of {totalMB} MB
                      </Text>
                      <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                        {pctLabel}
                      </Text>
                    </View>
                    <View className="h-1.5 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${Math.round(downloadPct * 100)}%`, backgroundColor: accent[500] }}
                      />
                    </View>
                    <Pressable
                      onPress={handleCancelDownload}
                      disabled={downloadState === "cancelling"}
                      className="flex-row items-center justify-center mt-3 py-2 rounded-lg border border-border-light dark:border-border-dark"
                    >
                      {downloadState === "cancelling" ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : (
                        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                          Cancel
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* Download button */}
                {!modelDownloaded && downloadState === "idle" && (
                  <Pressable
                    onPress={handleDownload}
                    className="flex-row items-center justify-center mt-3 py-3 rounded-lg"
                    style={{ backgroundColor: accent[500] }}
                  >
                    <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                    <Text className="text-sm font-semibold text-white ml-2">
                      Download model (~880 MB)
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* Delete model */}
              {modelDownloaded && (
                <Pressable
                  onPress={handleDeleteModel}
                  className="flex-row items-center py-3"
                >
                  <Ionicons name="trash-outline" size={18} color="#f85149" />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm text-danger">Delete model</Text>
                    <Text className="text-xs text-text-tertiary mt-0.5">
                      Frees ~{modelSizeMB || MODEL_SIZE_MB} MB of storage
                    </Text>
                  </View>
                </Pressable>
              )}
            </Card>
          )}

          {/* Debug info — shows path and last init error so we can diagnose failures */}
          {aiEnabled && (initError || modelPath) && (
            <Card title="Debug Info" className="mb-4">
              <View className="py-2">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-1">Model path:</Text>
                <Text className="text-xs font-mono" style={{ color: initError ? "#f85149" : "#3fb950" }} selectable>
                  {modelPath || "—"}
                </Text>
                {initError && (
                  <>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-3 mb-1">Init error:</Text>
                    <Text className="text-xs text-danger" selectable>{initError}</Text>
                  </>
                )}
              </View>
            </Card>
          )}

          {/* Natural language search — independent of model */}
          <Card title="Natural Language Search" className="mb-4">
            <View className="flex-row items-center justify-between py-2">
              <View className="flex-1 mr-3">
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  Smart search
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                  Search Transactions with phrases like "food expenses last month". Rule-based — works without model download.
                </Text>
              </View>
              <Switch
                value={nlSearchEnabled}
                onValueChange={handleNLSearchToggle}
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
