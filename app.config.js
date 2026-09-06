/**
 * Dynamic Expo config.
 *
 * Exists for exactly one reason: to point Expo Router at `preview/` instead of `app/` when the
 * preview harness is running. Everything else comes from app.json unchanged, so prebuild and the
 * release build behave exactly as before - verify with `npx expo config --type prebuild`.
 *
 * The preview root has to be swapped rather than added because app/_layout.tsx initialises the
 * database, MMKV, the SMS scan and background tasks on mount. None of those exist in a browser,
 * which is why the design system has only ever been viewable on an Android device.
 */
module.exports = ({ config }) => {
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
