import { useState, useCallback, useEffect, useRef } from "react";
import { View, Pressable, ScrollView, Switch, TextInput, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import {
  createBackup,
  shareBackup,
  saveBackupToStorage,
  cleanupBackupFile,
  pickAndValidateBackupFile,
  restoreBackup,
  MIN_PASSWORD_LENGTH,
} from "@/services/backup";
import type { BackupResult, RestoreResult, PickedBackupFile } from "@/services/backup";
import {
  getBackupScheduleSettings,
  setBackupScheduleSettings,
  getLastScheduledBackupAt,
  listScheduledBackups,
  restoreScheduledBackup,
  deleteScheduledBackup,
  shareScheduledBackup,
  syncScheduledBackupNotification,
  syncBackupBackgroundTask,
  formatLastBackupTime,
  formatNextBackup,
  formatFileSize,
} from "@/services/backup-schedule";
import type { BackupScheduleSettings, ScheduledBackupInfo } from "@/services/backup-schedule";
import { useTheme } from "@/hooks/use-theme";

type Mode = "menu" | "backup" | "restore";

const FREQ_OPTIONS = [
  { label: "4h", hours: 4 },
  { label: "6h", hours: 6 },
  { label: "8h", hours: 8 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
] as const;

export default function BackupRestoreScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>("menu");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const pendingBackupFileRef = useRef<string | null>(null);
  useEffect(() => {
    pendingBackupFileRef.current = backupResult?.filePath ?? null;
  }, [backupResult]);
  useEffect(() => {
    return () => {
      if (pendingBackupFileRef.current) cleanupBackupFile(pendingBackupFileRef.current);
    };
  }, []);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [pickedFile, setPickedFile] = useState<PickedBackupFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Scheduled backup state
  const [schedSettings, setSchedSettings] = useState<BackupScheduleSettings>(() => getBackupScheduleSettings());
  const [schedBackups, setSchedBackups] = useState<ScheduledBackupInfo[]>([]);
  const [restoringScheduled, setRestoringScheduled] = useState<string | null>(null);

  const reloadSchedBackups = useCallback(() => {
    setSchedBackups(listScheduledBackups());
  }, []);

  useFocusEffect(useCallback(() => {
    if (mode === "menu") reloadSchedBackups();
  }, [mode, reloadSchedBackups]));

  useEffect(() => {
    if (mode === "menu") reloadSchedBackups();
  }, [mode, reloadSchedBackups]);

  // Android-only: Save to Phone via Storage Access Framework (SAF).
  const doSaveToPhone = useCallback(async (filePath: string) => {
    const r = await saveBackupToStorage(filePath);
    if (r.ok) {
      alert("Saved", "Backup saved to your chosen folder.");
    } else if (r.cancelled) {
      // user cancelled picker — fall back silently
    } else if (r.unsupported) {
      alert("Not Supported", "Save to Phone is Android-only. Use Share instead.");
    } else {
      alert("Save Failed", r.error ?? "Unknown error.");
    }
  }, [alert]);

  // --- Backup ---
  const handleCreateBackup = useCallback(async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      alert("Password Too Short", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      alert("Passwords Don't Match", "Please enter the same password in both fields.");
      return;
    }

    setLoading(true);
    const result = await createBackup(password);
    setBackupResult(result);
    setLoading(false);

    if (result.success && result.filePath) {
      const buttons = [
        { text: "Later", style: "cancel" as const },
        ...(Platform.OS === "android"
          ? [{ text: "Save to phone", onPress: () => doSaveToPhone(result.filePath!) }]
          : []),
        { text: "Share", onPress: () => shareBackup(result.filePath!) },
      ];
      alert("Backup Created", "Where would you like to save it?", buttons);
    }
  }, [password, confirmPassword, alert, doSaveToPhone]);

  // --- Restore ---
  const handlePickFile = useCallback(async () => {
    setFileError(null);
    try {
      const file = await pickAndValidateBackupFile();
      if (!file) return;
      setPickedFile(file);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleRestore = useCallback(async () => {
    if (!pickedFile) return;

    if (!pickedFile.isAutoBackup && password.length < MIN_PASSWORD_LENGTH) {
      alert("Enter Password", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    alert(
      "Restore Backup",
      "This will REPLACE all current data with the backup. This cannot be undone. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            const result = pickedFile.isAutoBackup
              ? await restoreScheduledBackup(pickedFile.uri)
              : await restoreBackup(pickedFile.uri, password);
            setRestoreResult(result);
            setLoading(false);
          },
        },
      ],
    );
  }, [pickedFile, password, alert]);

  // --- Scheduled backup handlers ---
  const handleToggleScheduled = useCallback((val: boolean) => {
    const updated = { ...schedSettings, enabled: val };
    setSchedSettings(updated);
    setBackupScheduleSettings(updated);
    void syncScheduledBackupNotification(updated);
    void syncBackupBackgroundTask();
  }, [schedSettings]);

  const handlePickFrequency = useCallback((hours: number) => {
    const updated = { ...schedSettings, frequencyHours: hours };
    setSchedSettings(updated);
    setBackupScheduleSettings(updated);
    void syncScheduledBackupNotification(updated);
    void syncBackupBackgroundTask();
  }, [schedSettings]);

  const handleRestoreScheduled = useCallback((info: ScheduledBackupInfo) => {
    alert(
      "Restore Backup",
      `Restore to the backup from ${info.timestamp.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}?\n\nThis will REPLACE all current data. Cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setRestoringScheduled(info.filePath);
            const result = await restoreScheduledBackup(info.filePath);
            setRestoringScheduled(null);
            if (result.success) {
              alert("Restored", `Backup restored — ${result.totalRows} records loaded.`);
              reloadSchedBackups();
            } else {
              alert("Restore Failed", result.error ?? "Unknown error");
            }
          },
        },
      ],
    );
  }, [alert, reloadSchedBackups]);

  const handleDeleteScheduled = useCallback((info: ScheduledBackupInfo) => {
    alert(
      "Delete Backup",
      "Remove this backup? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteScheduledBackup(info.filePath);
            setSchedBackups((prev) => prev.filter((b) => b.filePath !== info.filePath));
          },
        },
      ],
    );
  }, [alert]);

  const handleShareScheduled = useCallback(async (info: ScheduledBackupInfo) => {
    await shareScheduledBackup(info.filePath);
  }, []);

  const resetState = useCallback(() => {
    setMode("menu");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setBackupResult(null);
    setRestoreResult(null);
    setPickedFile(null);
    setFileError(null);
  }, []);

  return (
    <>
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Menu */}
        {mode === "menu" && (
          <View className="py-4">
            <Text className="text-sm text-muted-foreground mb-6">
              Create encrypted backups of your data or restore from a previous backup.
            </Text>

            <Pressable
              onPress={() => setMode("backup")}
              className="flex-row items-center p-4 mb-3 rounded-lg border border-border"
            >
              <View className="w-12 h-12 rounded-full bg-success/8 items-center justify-center mr-4">
                <Ionicons name="cloud-upload-outline" size={24} color={theme.success} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Create Backup
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Save all your data as an encrypted file
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setMode("restore")}
              className="flex-row items-center p-4 mb-3 rounded-lg border border-border"
            >
              <View className="w-12 h-12 rounded-full items-center justify-center mr-4" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                <Ionicons name="cloud-download-outline" size={24} color={colors.blue} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Restore from Backup
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Load data from an .arth backup file
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>

            <View className="mt-4 p-3 rounded-lg bg-warning/8">
              <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                Keep your password safe
              </Text>
              <Text className="text-xs text-muted-foreground">
                Without your backup password, the backup cannot be restored.
                There is no recovery mechanism.
              </Text>
            </View>

            {/* Scheduled Backup */}
            <View className="mt-6">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Scheduled Backup
              </Text>

              {/* Toggle */}
              <View className="flex-row items-center p-4 mb-3 rounded-lg border border-border">
                <View className="flex-1 mr-4">
                  <Text className="text-base font-semibold text-foreground">
                    Auto backup
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    Saves a backup automatically at the chosen interval, even when the app is closed
                  </Text>
                </View>
                <Switch
                  value={schedSettings.enabled}
                  onValueChange={handleToggleScheduled}
                  trackColor={{ false: colors.border, true: theme.primary }}
                  thumbColor={schedSettings.enabled ? "#FFFFFF" : "#FFFFFF"}
                />
              </View>

              {schedSettings.enabled && (
                <>
                  {/* Frequency chips */}
                  <View className="p-4 mb-3 rounded-lg border border-border">
                    <Text className="text-sm text-muted-foreground mb-3">
                      Back up every
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {FREQ_OPTIONS.map((o) => {
                        const active = schedSettings.frequencyHours === o.hours;
                        return (
                          <Pressable
                            key={o.hours}
                            onPress={() => handlePickFrequency(o.hours)}
                            className="py-1.5 px-3 rounded-full border"
                            style={{
                              backgroundColor: active ? theme.primary + "22" : "transparent",
                              borderColor: active ? theme.primary : colors.border,
                            }}
                          >
                            <Text
                              className="text-sm font-medium"
                              style={{ color: active ? theme.primary : colors.textSecondary }}
                            >
                              {o.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Last / next backup status */}
                  <View className="flex-row items-center justify-between px-1 mb-3">
                    <View className="flex-row items-center">
                      <Ionicons name="checkmark-circle-outline" size={15} color={colors.textSecondary} />
                      <Text className="ml-1.5 text-xs text-muted-foreground">
                        Last: {formatLastBackupTime(getLastScheduledBackupAt())}
                      </Text>
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      Next: {formatNextBackup(schedSettings.frequencyHours)}
                    </Text>
                  </View>
                </>
              )}

              {/* Stored backups list */}
              {schedBackups.length > 0 && (
                <>
                  <Text className="text-xs text-muted-foreground mb-2">
                    {schedBackups.length} stored backup{schedBackups.length !== 1 ? "s" : ""} · newest first
                  </Text>
                  {schedBackups.map((b) => (
                    <View
                      key={b.filePath}
                      className="flex-row items-center p-3 mb-2 rounded-lg border border-border"
                    >
                      <View className="w-9 h-9 rounded-full bg-success/8 items-center justify-center mr-3 shrink-0">
                        <Ionicons name="shield-checkmark-outline" size={18} color={theme.success} />
                      </View>
                      <View className="flex-1 mr-2">
                        <Text className="text-sm font-medium text-foreground">
                          {b.timestamp.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {b.timestamp.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          {b.fileSizeBytes > 0 ? ` · ${formatFileSize(b.fileSizeBytes)}` : ""}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleRestoreScheduled(b)}
                        disabled={restoringScheduled === b.filePath}
                        className="py-1.5 px-3 rounded-lg mr-2"
                        style={{ backgroundColor: theme.primary + "22" }}
                      >
                        <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                          {restoringScheduled === b.filePath ? "…" : "Restore"}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => handleShareScheduled(b)} hitSlop={8} className="mr-2">
                        <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => handleDeleteScheduled(b)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={theme.danger} />
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
            </View>
          </View>
        )}

        {/* Create Backup */}
        {mode === "backup" && !backupResult && (
          <View className="py-4">
            <Pressable onPress={resetState} className="flex-row items-center mb-4">
              <Ionicons name="arrow-back" size={20} color={colors.blue} />
              <Text className="ml-2 font-medium" style={{ color: theme.primary }}>
                Back
              </Text>
            </Pressable>

            <Text className="text-xl font-bold text-foreground mb-2">
              Create Backup
            </Text>
            <Text className="text-sm text-muted-foreground mb-6">
              Set a password to encrypt your backup. You'll need this password to restore.
            </Text>

            <Text className="text-sm font-medium text-foreground mb-1">
              Password
            </Text>
            <View className="flex-row items-center border border-border rounded-lg mb-4">
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter backup password"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Backup password"
                maxLength={128}
                className="flex-1 px-4 py-3 text-base text-foreground"
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} className="px-3" hitSlop={8}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text className="text-sm font-medium text-foreground mb-1">
              Confirm Password
            </Text>
            <View className="flex-row items-center border border-border rounded-lg mb-6">
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                placeholder="Re-enter password"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Confirm backup password"
                maxLength={128}
                className="flex-1 px-4 py-3 text-base text-foreground"
              />
              <Pressable onPress={() => setShowConfirmPassword((v) => !v)} className="px-3" hitSlop={8}>
                <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Button
              title="Create Encrypted Backup"
              onPress={handleCreateBackup}
              disabled={loading}
              loading={loading}
            />
          </View>
        )}

        {/* Backup Result */}
        {mode === "backup" && backupResult && (
          <View className="items-center py-8">
            <View
              className={`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                backupResult.success ? "bg-success/8" : "bg-danger/8"
              }`}
            >
              <Ionicons
                name={backupResult.success ? "checkmark-circle" : "close-circle"}
                size={40}
                color={backupResult.success ? theme.success : theme.danger}
              />
            </View>

            <Text className="text-xl font-bold text-foreground mb-2">
              {backupResult.success ? "Backup Created" : "Backup Failed"}
            </Text>

            {backupResult.success && backupResult.metadata && (
              <View className="w-full rounded-lg border border-border p-4 mt-4">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Tables backed up</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {backupResult.metadata.tables.length}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Total records</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {Object.values(backupResult.metadata.rowCounts).reduce((a, b) => a + b, 0)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted-foreground">Created</Text>
                  <Text className="text-sm text-foreground">
                    {new Date(backupResult.metadata.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            {backupResult.error && (
              <Text className="text-sm text-danger mt-4">{backupResult.error}</Text>
            )}

            <View className="mt-6 gap-2">
              {backupResult.success && backupResult.filePath && Platform.OS === "android" && (
                <Button title="Save to phone" onPress={() => doSaveToPhone(backupResult.filePath!)} />
              )}
              {backupResult.success && backupResult.filePath && (
                <Button
                  title="Share"
                  onPress={() => shareBackup(backupResult.filePath!)}
                  variant={Platform.OS === "android" ? "outline" : undefined}
                />
              )}
              <Button
                title="Done"
                onPress={() => {
                  if (backupResult?.filePath) cleanupBackupFile(backupResult.filePath);
                  pendingBackupFileRef.current = null;
                  resetState();
                }}
                variant="ghost"
              />
            </View>
          </View>
        )}

        {/* Restore */}
        {mode === "restore" && !restoreResult && (
          <View className="py-4">
            <Pressable onPress={resetState} className="flex-row items-center mb-4">
              <Ionicons name="arrow-back" size={20} color={colors.blue} />
              <Text className="ml-2 font-medium" style={{ color: theme.primary }}>
                Back
              </Text>
            </Pressable>

            <Text className="text-xl font-bold text-foreground mb-2">
              Restore from Backup
            </Text>
            <Text className="text-sm text-muted-foreground mb-6">
              Select your .arth backup file (or a .json auto-backup), then enter the password to decrypt.
            </Text>

            {!pickedFile ? (
              <View>
                <Button title="Select Backup File" onPress={handlePickFile} variant="outline" />
                {fileError && (
                  <View className="mt-3 p-3 rounded-lg bg-danger/8">
                    <Text className="text-sm text-danger font-medium">{fileError}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View>
                <View className="flex-row items-center p-3 mb-4 rounded-lg border border-border" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                  <Ionicons name="document-attach-outline" size={24} color={theme.success} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {pickedFile.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {pickedFile.sizeLabel} · {pickedFile.isAutoBackup ? "Auto-backup (no password needed)" : "Encrypted backup"}
                    </Text>
                  </View>
                  <Pressable onPress={() => { setPickedFile(null); setPassword(""); }} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>

                {!pickedFile.isAutoBackup && (
                  <>
                    <Text className="text-sm font-medium text-foreground mb-1">
                      Backup Password
                    </Text>
                    <View className="flex-row items-center border border-border rounded-lg mb-4">
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        placeholder="Enter backup password"
                        placeholderTextColor={colors.textSecondary}
                        accessibilityLabel="Restore password"
                        maxLength={128}
                        className="flex-1 px-4 py-3 text-base text-foreground"
                      />
                      <Pressable onPress={() => setShowPassword((v) => !v)} className="px-3" hitSlop={8}>
                        <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                  </>
                )}

                <View className="p-3 rounded-lg bg-danger/8 mb-4">
                  <Text className="text-sm text-danger font-medium">
                    Warning: Restoring will replace ALL current data.
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1">
                    Create a backup first if you want to keep your current data.
                  </Text>
                </View>

                <Button
                  title="Restore"
                  onPress={handleRestore}
                  disabled={loading || (!pickedFile.isAutoBackup && password.length < MIN_PASSWORD_LENGTH)}
                  loading={loading}
                />
              </View>
            )}
          </View>
        )}

        {/* Restore Result */}
        {mode === "restore" && restoreResult && (
          <View className="items-center py-8">
            <View
              className={`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                restoreResult.success ? "bg-success/8" : "bg-danger/8"
              }`}
            >
              <Ionicons
                name={restoreResult.success ? "checkmark-circle" : "close-circle"}
                size={40}
                color={restoreResult.success ? theme.success : theme.danger}
              />
            </View>

            <Text className="text-xl font-bold text-foreground mb-2">
              {restoreResult.success ? "Restore Complete" : "Restore Failed"}
            </Text>

            {restoreResult.success && (
              <View className="w-full rounded-lg border border-border p-4 mt-4">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-muted-foreground">Tables restored</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {restoreResult.tablesRestored.length}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted-foreground">Total records</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {restoreResult.totalRows}
                  </Text>
                </View>
              </View>
            )}

            {restoreResult.error && (
              <Text className="text-sm text-danger mt-4 text-center">{restoreResult.error}</Text>
            )}

            <Button
              title="Done"
              onPress={() => {
                resetState();
                if (restoreResult.success) router.back();
              }}
              className="mt-6"
            />
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
    </>
  );
}
