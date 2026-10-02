/**
 * Dynamic Expo config.
 *
 * Two jobs: point Expo Router at `preview/` when the preview harness is running, and turn a
 * build into the separate "Arth Demo" app when ARTH_DEMO=1 (store screenshots). Everything else comes from app.json unchanged, so prebuild and the
 * release build behave exactly as before - verify with `npx expo config --type prebuild`.
 *
 * The preview root has to be swapped rather than added because app/_layout.tsx initialises the
 * database, MMKV, the SMS scan and background tasks on mount. None of those exist in a browser,
 * which is why the design system has only ever been viewable on an Android device.
 */
module.exports = ({ config }) => {
  // Demo build for store screenshots (ARTH_DEMO=1): a separate app, "Arth Demo"
  // (com.souravbaid.arth.demo), so it installs next to the real Arth and never touches its
  // data. `extra.demoData` unlocks Settings > Load sample data (services/demo-data.ts).
  // scripts/verify-release.ps1 fails if a release build still carries the demo package.
  if (process.env.ARTH_DEMO === "1") {
    config = {
      ...config,
      name: "Arth Demo",
      android: { ...config.android, package: `${config.android.package}.demo` },
      extra: { ...(config.extra ?? {}), demoData: true },
    };
  }
  if (process.env.ARTH_PREVIEW !== "1") return config;
  return {
    ...config,
    // Typed routes OFF for the harness. The generator writes .expo/types/router.d.ts from
    // whatever the current router root is, so leaving it on would have the preview server
    // silently overwrite the real app's route map with the harness's single route - and the
    // whole app then fails to typecheck.
    experiments: { ...(config.experiments ?? {}), typedRoutes: false },
    extra: {
      ...(config.extra ?? {}),
      router: { ...(config.extra?.router ?? {}), root: "preview" },
    },
  };
};
