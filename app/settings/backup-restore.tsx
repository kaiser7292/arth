import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import {
  createBackup,
  shareBackup,
  saveBackupToStorage,
  pickAndValidateBackupFile,
  restoreBackup,
  MIN_PASSWORD_LENGTH,
} from "@/services/backup";
import type { BackupResult, RestoreResult, PickedBackupFile } from "@/services/backup";

type Mode = "menu" | "backup" | "restore";

export default function BackupRestoreScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const [mode, setMode] = useState<Mode>("menu");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(
    null,
  );
  const [pickedFile, setPickedFile] = useState<PickedBackupFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Android-only: Save to Phone via Storage Access Framework (SAF).
  // Pre-seeds the picker in Downloads; user can still navigate anywhere.
  const doSaveToPhone = useCallback(async (filePath: string) => {
    const r = await saveBackupToStorage(filePath);
    if (r.ok) {
      alert("Saved", "Backup saved to your chosen folder.");
    } else if (r.cancelled) {
      // User cancelled the picker; fall back silently — they can re-trigger.
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
          ? [{
              text: "Save to phone",
              onPress: () => doSaveToPhone(result.filePath!),
            }]
          : []),
        {
          text: "Share",
          onPress: () => shareBackup(result.filePath!),
        },
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
    if (password.length < MIN_PASSWORD_LENGTH) {
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
            const result = await restoreBackup(pickedFile.uri, password);
            setRestoreResult(result);
            setLoading(false);
          },
        },
      ],
    );
  }, [pickedFile, password]);

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
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Menu */}
        {mode === "menu" && (
          <View className="py-4">
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6">
              Create encrypted backups of your data or restore from a previous backup.
            </Text>

            <Pressable
              onPress={() => setMode("backup")}
              className="flex-row items-center p-4 mb-3 rounded-lg border border-border-light dark:border-border-dark"
            >
              <View className="w-12 h-12 rounded-full bg-success/8 items-center justify-center mr-4">
                <Ionicons name="cloud-upload-outline" size={24} color={StatusColors[colorScheme].success} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                  Create Backup
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                  Save all your data as an encrypted file
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setMode("restore")}
              className="flex-row items-center p-4 mb-3 rounded-lg border border-border-light dark:border-border-dark"
            >
              <View className="w-12 h-12 rounded-full items-center justify-center mr-4" style={{ backgroundColor: accent[500] + '14' }}>
                <Ionicons name="cloud-download-outline" size={24} color={colors.blue} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                  Restore from Backup
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                  Load data from an .artha backup file
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>

            <View className="mt-4 p-3 rounded-lg bg-[#F59E0B14]">
              <Text className="text-sm font-medium mb-1" style={{ color: StatusColors[colorScheme].warning }}>
                Keep your password safe
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Without your backup password, the backup cannot be restored.
                There is no recovery mechanism.
              </Text>
            </View>
          </View>
        )}

        {/* Create Backup */}
        {mode === "backup" && !backupResult && (
          <View className="py-4">
            <Pressable onPress={resetState} className="flex-row items-center mb-4">
              <Ionicons name="arrow-back" size={20} color={colors.blue} />
              <Text className="ml-2 font-medium" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                Back
              </Text>
            </Pressable>

            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              Create Backup
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6">
              Set a password to encrypt your backup. You'll need this password to restore.
            </Text>

            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mb-1">
              Password
            </Text>
            <View className="flex-row items-center border border-border-light dark:border-border-dark rounded-lg mb-4">
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter backup password"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Backup password"
                maxLength={128}
                className="flex-1 px-4 py-3 text-base text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} className="px-3" hitSlop={8}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mb-1">
              Confirm Password
            </Text>
            <View className="flex-row items-center border border-border-light dark:border-border-dark rounded-lg mb-6">
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                placeholder="Re-enter password"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Confirm backup password"
                maxLength={128}
                className="flex-1 px-4 py-3 text-base text-text-primary dark:text-text-dark-primary"
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
                backupResult.success ? "bg-success/8" : "bg-[#EF444414]"
              }`}
            >
              <Ionicons
                name={backupResult.success ? "checkmark-circle" : "close-circle"}
                size={40}
                color={backupResult.success ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
              />
            </View>

            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              {backupResult.success ? "Backup Created" : "Backup Failed"}
            </Text>

            {backupResult.success && backupResult.metadata && (
              <View className="w-full rounded-lg border border-border-light dark:border-border-dark p-4 mt-4">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Tables backed up</Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {backupResult.metadata.tables.length}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total records</Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {Object.values(backupResult.metadata.rowCounts).reduce(
                      (a, b) => a + b,
                      0,
                    )}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Created</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                    {new Date(backupResult.metadata.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            {backupResult.error && (
              <Text className="text-sm text-danger mt-4">
                {backupResult.error}
              </Text>
            )}

            {/* v16.0.8 — stack the action buttons vertically. Previously
                three buttons with varying label lengths ("Save to Phone",
                "Share...", "Done") were laid out side-by-side and would
                wrap unpredictably, making them look mismatched and
                truncate on narrow devices. Vertical stacking gives each
                button the full width, consistent height, and no
                truncation risk. */}
            <View className="mt-6 gap-2">
              {backupResult.success && backupResult.filePath && Platform.OS === "android" && (
                <Button
                  title="Save to phone"
                  onPress={() => doSaveToPhone(backupResult.filePath!)}
                />
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
                onPress={resetState}
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
              <Text className="ml-2 font-medium" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                Back
              </Text>
            </Pressable>

            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              Restore from Backup
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6">
              Select your .artha backup file, then enter the password to decrypt.
            </Text>

            {/* Step 1: Pick file */}
            {!pickedFile ? (
              <View>
                <Button
                  title="Select Backup File"
                  onPress={handlePickFile}
                  variant="outline"
                />
                {fileError && (
                  <View className="mt-3 p-3 rounded-lg bg-[#EF444414]">
                    <Text className="text-sm text-danger font-medium">{fileError}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View>
                {/* File info card */}
                <View className="flex-row items-center p-3 mb-4 rounded-lg border border-border-light dark:border-border-dark" style={{ backgroundColor: StatusColors[colorScheme].successBg }}>
                  <Ionicons name="document-attach-outline" size={24} color={StatusColors[colorScheme].success} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                      {pickedFile.name}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {pickedFile.sizeLabel} — Valid Artha backup
                    </Text>
                  </View>
                  <Pressable onPress={() => { setPickedFile(null); setPassword(""); }} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>

                {/* Step 2: Password */}
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mb-1">
                  Backup Password
                </Text>
                <View className="flex-row items-center border border-border-light dark:border-border-dark rounded-lg mb-4">
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    placeholder="Enter backup password"
                    placeholderTextColor={colors.textSecondary}
                    accessibilityLabel="Restore password"
                    maxLength={128}
                    className="flex-1 px-4 py-3 text-base text-text-primary dark:text-text-dark-primary"
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} className="px-3" hitSlop={8}>
                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
                  </Pressable>
                </View>

                <View className="p-3 rounded-lg bg-[#EF444414] mb-4">
                  <Text className="text-sm text-danger font-medium">
                    Warning: Restoring will replace ALL current data.
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                    Create a backup first if you want to keep your current data.
                  </Text>
                </View>

                <Button
                  title="Restore"
                  onPress={handleRestore}
                  disabled={loading || password.length < MIN_PASSWORD_LENGTH}
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
                restoreResult.success ? "bg-success/8" : "bg-[#EF444414]"
              }`}
            >
              <Ionicons
                name={restoreResult.success ? "checkmark-circle" : "close-circle"}
                size={40}
                color={restoreResult.success ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
              />
            </View>

            <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
              {restoreResult.success ? "Restore Complete" : "Restore Failed"}
            </Text>

            {restoreResult.success && (
              <View className="w-full rounded-lg border border-border-light dark:border-border-dark p-4 mt-4">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Tables restored</Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {restoreResult.tablesRestored.length}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Total records</Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {restoreResult.totalRows}
                  </Text>
                </View>
              </View>
            )}

            {restoreResult.error && (
              <Text className="text-sm text-danger mt-4 text-center">
                {restoreResult.error}
              </Text>
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
  );
}
