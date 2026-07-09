import { DEFAULT_USER_ID } from "@/constants/app";
import { ALLOWED_DEEP_LINK_SCREENS } from "@/constants/routes";
import { initDatabase } from "@/database";
import { AlertProvider } from "@/hooks/use-alert";
import { AccentProvider } from "@/hooks/use-color-scheme";
import { setPendingDeepLink, shouldShowLock } from "@/services/biometric-lock";
import { seedDefaultCategories } from "@/services/category";
import { getFlag } from "@/services/feature-flags";
import { preloadHomeData } from "@/services/home-preload";
import { runDailyNotificationCheck, syncNotifBackgroundTask } from "@/services/notification-scheduler";
import { runScheduledBackupIfDue, syncBackupBackgroundTask } from "@/services/backup-schedule";
import { requestNotificationPermissions, setupNotificationChannel } from "@/services/notifications";
import { migrateExistingUser } from "@/services/onboarding";
import { seedDefaultPaymentModes } from "@/services/payment-mode";
import { seedPublicData } from "@/services/public-data";
import { getOnboardingCompletedVersion } from "@/services/settings";
import { runSmsScan } from "@/services/sms";
import { settingsStorage } from "@/services/storage";
import { logger } from "@/utils/logger";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as TaskManager from "expo-task-manager";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Appearance, AppState, BackHandler, Easing, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Circle, G, Rect, Svg } from "react-native-svg";
import "../global.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: "#111111", padding: 32, paddingTop: 80 }}>
          <Text style={{ color: "#EF4444", fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>
            Something went wrong
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: 14, marginBottom: 24 }}>
            Please close and reopen the app to continue.
          </Text>
          <TouchableOpacity
            onPress={() => BackHandler.exitApp()}
            style={{ backgroundColor: "#134E4A", padding: 14, borderRadius: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Close App</Text>
          </TouchableOpacity>
          {__DEV__ && (
            <ScrollView style={{ marginTop: 16 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 14, marginBottom: 8 }}>
                {this.state.error.message}
              </Text>
              <Text style={{ color: "#6B7280", fontSize: 12 }}>
                {this.state.error.stack}
              </Text>
            </ScrollView>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

function SplashScreen({ step }: { step: string }) {
  const isDark = Appearance.getColorScheme() === "dark";
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#111111" : "#FFFFFF" }}>
      <Animated.View style={{ 
        opacity: pulseAnim,
        marginBottom: 20,
        shadowColor: "#134E4A",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8
      }}>
        <View style={{ width: 120, height: 120, borderRadius: 30, overflow: 'hidden' }}>
          <Svg width={120} height={120} viewBox="0 0 400 400">
            <Rect
              width="400"
              height="400"
              rx="80"
              ry="80"
              fill="#134E4A"
            />
            <Circle
              cx="200"
              cy="200"
              r="152"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="5.5"
            />
            <Circle
              cx="200"
              cy="200"
              r="139"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.2"
            />
            <G fill="#F59E0B" opacity={0.6}>
              <Circle cx="200" cy="55" r="2.3"/>
              <Circle cx="271" cy="75" r="2.3"/>
              <Circle cx="325" cy="129" r="2.3"/>
              <Circle cx="345" cy="200" r="2.3"/>
              <Circle cx="325" cy="271" r="2.3"/>
              <Circle cx="271" cy="325" r="2.3"/>
              <Circle cx="200" cy="345" r="2.3"/>
              <Circle cx="129" cy="325" r="2.3"/>
              <Circle cx="75" cy="271" r="2.3"/>
              <Circle cx="55" cy="200" r="2.3"/>
              <Circle cx="75" cy="129" r="2.3"/>
              <Circle cx="129" cy="75" r="2.3"/>
            </G>
          </Svg>
          <View style={{ position: 'absolute', width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 60, fontWeight: "bold", color: "#FFFFFF" }}>अ</Text>
          </View>
        </View>
      </Animated.View>
      <Text style={{ fontSize: 36, fontWeight: "bold", color: isDark ? "#FFFFFF" : "#111111", letterSpacing: 2 }}>
        अर्थ
      </Text>
      <Text style={{ fontSize: 16, fontWeight: "600", color: isDark ? "#D1D5DB" : "#6B7280", marginTop: 4, letterSpacing: 3, textTransform: "uppercase" }}>
        Arth
      </Text>
      <Text style={{ fontSize: 13, color: isDark ? "#6B7280" : "#9CA3AF", marginTop: 12, fontStyle: "italic" }}>
        your finances, your way
      </Text>
      <Text style={{ fontSize: 12, color: isDark ? "#6B7280" : "#9CA3AF", marginTop: 32 }}>
        {step}
      </Text>
    </View>
  );
}

/**
 * Cancels background work registered by the old scheduled-scan system
 * (removed in v11.1.4). OS-level registrations persist across app updates
 * so we clean them up on every startup until we're confident no user
 * still has leftovers.
 */
const LEGACY_SMS_CHECK_TASK = "ARTHA_SMS_CHECK";
const LEGACY_CLEANUP_DONE_KEY = "legacy_sms_task_cleaned";

async function cleanupLegacyScheduledScan(): Promise<void> {
  // Once confirmed clean, skip this every-startup pass — it was unconditionally
  // cancelling ALL scheduled notifications (Layer 1 EMI/reminder/daily alarms)
  // on every cold start, which on battery-aggressive Android OEMs (MIUI,
  // ColorOS) can get the app rate-limited for notifications.
  if (settingsStorage.getBoolean(LEGACY_CLEANUP_DONE_KEY)) return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(LEGACY_SMS_CHECK_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(LEGACY_SMS_CHECK_TASK);
    }
  } catch (e) {
    // TaskManager may throw if the task definition isn't present in this build
    // (because we removed sms-listener.ts). unregisterTaskAsync still succeeds
    // against an undefined task name, but guard defensively.
    logger.warn("Legacy SMS task cleanup failed:", e);
  }
  try {
    // The v11.1.3 scheduler queued recurring notifications via
    // scheduleNotificationAsync with future triggers. Those fire even when
    // the app is closed. All legitimate notifications in this app use
    // trigger: null (immediate), so cancelling scheduled ones is safe.
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    logger.warn("Legacy scheduled notification cleanup failed:", e);
  }
  settingsStorage.set(LEGACY_CLEANUP_DONE_KEY, true);
}

export default function RootLayout(): React.JSX.Element {
  const [dbReady, setDbReady] = useState(false);
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [lockEvaluated, setLockEvaluated] = useState(false);
  const [lockEvaluationInProgress, setLockEvaluationInProgress] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initStep, setInitStep] = useState("Starting up...");
  const [retryCount, setRetryCount] = useState(0);
  const [stepStartTime, setStepStartTime] = useState(Date.now());
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // Detect fresh install once at component mount
  const isFreshInstall = !getOnboardingCompletedVersion();
  // If migrateExistingUser() fails, getOnboardingCompletedVersion() stays null
  // even for a genuine existing user — don't let that send them to the
  // onboarding wizard. See the redirect effect below.
  const migrationFailedRef = useRef(false);

  const MIN_STEP_DURATION = 1200;

  const setInitStepThrottled = useCallback((newStep: string) => {
    const elapsed = Date.now() - stepStartTime;
    if (elapsed < MIN_STEP_DURATION) {
      setTimeout(() => setInitStep(newStep), MIN_STEP_DURATION - elapsed);
    } else {
      setInitStep(newStep);
    }
    setStepStartTime(Date.now());
  }, [stepStartTime]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setDbReady(false);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Remove legacy scheduled-scan artefacts from earlier versions.
        // v11.1.3 and earlier registered a periodic SMS background task and
        // scheduled recurring notifications; those persist across app updates
        // until explicitly unregistered. Safe to call on every startup — both
        // APIs are no-ops when there's nothing to clean up.
        await cleanupLegacyScheduledScan();

        setInitStepThrottled(isFreshInstall ? "Setting up for the first time..." : "Preparing database...");
        
        // Set app start time for cold start detection in biometric lock
        const { setAppStartTime } = await import("@/services/biometric-lock");
        setAppStartTime();
        
        await initDatabase();
        setInitStepThrottled("Setting up your workspace...");
        // Post-migration seeds + notification channel setup are independent
        // of one another — run in parallel to shave ~150-300ms off cold start.
        // All are idempotent: repeat-safe across app launches.
        await Promise.all([
          seedDefaultCategories(DEFAULT_USER_ID),
          seedDefaultPaymentModes(DEFAULT_USER_ID),
          setupNotificationChannel(),
          getFlag("v15_public_data_seed")
            ? seedPublicData().catch((e) => logger.warn("Public-data seed failed (non-fatal):", e))
            : Promise.resolve(),
          getFlag("v15_onboarding_wizard")
            ? migrateExistingUser().catch((e) => {
                logger.warn("Onboarding migration failed (non-fatal):", e);
                migrationFailedRef.current = true;
              })
            : Promise.resolve(),
        ]);
        // v17.5.9 — splash must NOT wait for preload. preloadHomeData
        // includes scanAllDuplicatesCached, which scales with DB size; holding
        // the splash on it inflates cold-start time for users with long
        // history. Fire-and-forget — Home shows its own skeleton until the
        // preload cache settles. Any failure is logged but non-fatal.
        preloadHomeData().catch((e) => logger.warn("Home preload failed (non-fatal):", e));
        setInitStepThrottled("Almost ready...");
        // v17.5.0 — Android 13+ needs an explicit runtime POST_NOTIFICATIONS
        // prompt (declared in manifest since v17.5.0). Without this, the OS
        // silently drops every notification call. Fire-and-forget idempotent
        // request — returns immediately if permission was already granted.
        requestNotificationPermissions().catch((e) => logger.warn("Notif permission request failed:", e));
        // Fire-and-forget: run immediate check + ensure background task is registered
        runDailyNotificationCheck(DEFAULT_USER_ID).catch((e) => logger.warn("Daily notification check failed:", e));
        syncNotifBackgroundTask().catch((e) => logger.warn("Notif background task sync failed:", e));
        syncBackupBackgroundTask().catch((e) => logger.warn("Backup background task sync failed:", e));
        
        // Only set dbReady to true after successful initialization
        setDbReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message + "\n" + e.stack : String(e);
        logger.error("Database init failed:", msg);
        
        // On fresh install, auto-retry up to 3 times before showing error
        // This handles the case where DB creation is still in progress
        if (isFreshInstall && retryCount < 3) {
          logger.info(`Fresh install - auto-retrying database init (attempt ${retryCount + 1}/3)`);
          // Don't change the message - keep showing the same setup message
          // Wait 2 seconds before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
          setRetryCount((c) => c + 1);
          return;
        }
        
        setInitError(msg);
        // Do NOT set dbReady to true on error - this prevents the splash screen
        // from hiding and showing the error screen immediately
      }
    })();
  }, [retryCount]);

  // ─── App-open SMS scan (30-minute cooldown, managed by runSmsScan) ───
  const appOpenScanRan = useRef(false);
  useEffect(() => {
    if (!dbReady) return;

    const runScanIfDue = async () => {
      // v17.5.0 — notify=false for foreground app-open scans. The user is
      // already in the app and will see new items on the Home action card
      // or Review Queue; a push notification would be redundant noise (and
      // fires every single time the app is opened after new SMS arrived).
      const outcome = await runSmsScan({ manual: false });
      if (outcome.reason === "error") {
        logger.warn("App-open SMS scan failed:", outcome.error);
      }
    };

    if (!appOpenScanRan.current) {
      appOpenScanRan.current = true;
      runScanIfDue();
      void runScheduledBackupIfDue();
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runScanIfDue();
        void runScheduledBackupIfDue();
      }
    });
    return () => sub.remove();
  }, [dbReady]);

  // ─── v15.2: Biometric lock gate ───
  // Cold start + AppState "active" transitions → shouldShowLock() → redirect
  // to /(lock)/lock. The lock screen authenticates and replaces back to /(tabs).
  // lockEvaluated gates the splash so the user never sees a content flash
  // before the lock screen appears. It MUST be set on every code path.
  useEffect(() => {
    if (!dbReady || !minSplashDone) return;
    if (!getFlag("v15_biometric_lock")) {
      setLockEvaluated(true);
      return;
    }

    const evaluateLock = () => {
      if (!lockEvaluated && !lockEvaluationInProgress) {
        setLockEvaluationInProgress(true);
        if (shouldShowLock() && routerRef.current) {
          routerRef.current.replace("/(lock)/lock" as never);
        }
        setLockEvaluated(true);
        setLockEvaluationInProgress(false);
      }
    };

    evaluateLock();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") evaluateLock();
    });
    return () => sub.remove();
  }, [dbReady, minSplashDone, lockEvaluated, lockEvaluationInProgress]);

  // Handle notification tap → deep-link to the target screen
  // Whitelist of valid deep-link screens to prevent arbitrary navigation
  const ALLOWED_SCREENS = ALLOWED_DEEP_LINK_SCREENS;
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const screen = response.notification.request.content.data?.screen;
        if (!screen || typeof screen !== "string" || !routerRef.current || !ALLOWED_SCREENS.has(screen)) {
          return;
        }
        if (getFlag("v15_biometric_lock") && shouldShowLock()) {
          // Defer this navigation until after unlock instead of bypassing the
          // lock screen entirely — see services/biometric-lock.ts.
          setPendingDeepLink(screen);
          routerRef.current.replace("/(lock)/lock" as never);
          return;
        }
        routerRef.current.push(screen as never);
      },
    );
    return () => subscription.remove();
  }, []);

  // Ensure splash screen is visible briefly for branding
  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 800);
    return () => clearTimeout(timer);
  }, []);

  // v15: redirect fresh installs into the onboarding wizard.
  // migrateExistingUser() stamps upgraders before this runs, so only genuine
  // fresh installs have a null stamp and get redirected. If that migration
  // check failed, we don't know whether this is a fresh install or an
  // existing user whose stamp-write failed — err on the side of not
  // interrupting an existing user with the wizard.
  useEffect(() => {
    if (!dbReady || !minSplashDone || !lockEvaluated) return;
    if (!getFlag("v15_onboarding_wizard")) return;
    if (migrationFailedRef.current) return;
    if (getOnboardingCompletedVersion()) return;
    if (!routerRef.current) return;
    routerRef.current.replace("/(onboarding)/welcome" as never);
  }, [dbReady, minSplashDone, lockEvaluated]);

  // Show error screen first if initialization failed
  if (initError) {
    return (
      <View style={{ flex: 1, backgroundColor: "#111111", padding: 32, paddingTop: 80 }}>
        <Text style={{ color: "#EF4444", fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>
          Database Init Failed
        </Text>
        <Text style={{ color: "#FFFFFF", fontSize: 14, marginBottom: 24 }}>
          This may be a temporary issue. Try again or close and reopen the app.
        </Text>
        <TouchableOpacity
          onPress={retryInit}
          style={{ backgroundColor: "#134E4A", padding: 14, borderRadius: 10, alignItems: "center", marginBottom: 12 }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => BackHandler.exitApp()}
          style={{ borderWidth: 1, borderColor: "#374151", padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: "#9CA3AF", fontWeight: "600" }}>Close App</Text>
        </TouchableOpacity>
        {__DEV__ && (
          <ScrollView style={{ marginTop: 16 }}>
            <Text style={{ color: "#FFFFFF", fontSize: 12 }}>{initError}</Text>
          </ScrollView>
        )}
      </View>
    );
  }

  // Show splash screen during initialization
  if (!dbReady || !minSplashDone || !lockEvaluated) {
    return <SplashScreen step={initStep} />;
  }

  return (
    <ErrorBoundary>
    <AccentProvider>
    <AlertProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="expense"
          options={{ headerShown: false, presentation: "modal" }}
        />
        <Stack.Screen
          name="budget"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="summary"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="goals"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="hisaab"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="insights"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="reconciliation"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="demat"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="simulator"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="loans"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="(onboarding)"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="(lock)"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="vault"
          options={{ headerShown: false }}
        />
      </Stack>
    </>
    </GestureHandlerRootView>
    </AlertProvider>
    </AccentProvider>
    </ErrorBoundary>
  );
}
