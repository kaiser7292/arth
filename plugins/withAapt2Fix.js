const { withGradleProperties } = require("expo/config-plugins");

/**
 * Pins AAPT2 to the SDK-bundled binary to prevent the AGP 8.11+ daemon crash
 * on Windows ("Please check if you installed the Windows Universal C Runtime").
 * The downloaded AAPT2 binary from Maven is incompatible with this machine;
 * the build-tools 35.0.0 binary works correctly.
 */
function withAapt2Fix(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;
    const key = "android.aapt2FromMavenOverride";
    const value =
      "C:/Users/soura/scoop/apps/android-clt/14742923/build-tools/35.0.0/aapt2.exe";

    // Idempotency: remove any existing entry before adding
    config.modResults = props.filter((p) => !(p.type === "property" && p.key === key));
    config.modResults.push({ type: "property", key, value });
    return config;
  });
}

module.exports = withAapt2Fix;
