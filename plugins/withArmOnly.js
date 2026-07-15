const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Restricts the release APK to arm64-v8a only via splits config.
 * Cuts APK size from ~210 MB to ~120 MB by stripping x86/x86_64 emulator libs.
 * All modern Android phones (2015+) support arm64-v8a.
 *
 * Note: splits.abi and ndk.abiFilters are mutually exclusive in AGP 8+.
 * This plugin uses splits and removes any ndk.abiFilters block if present.
 */
function withArmOnly(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    // Remove ndk { abiFilters ... } if prebuild added it (conflicts with splits)
    gradle = gradle.replace(/\n\s*ndk \{\s*\n\s*abiFilters[^\n]*\n\s*\}/g, "");

    // Idempotency guard
    if (gradle.includes("splits {")) {
      config.modResults.contents = gradle;
      return config;
    }

    // Insert splits block after the closing brace of packagingOptions
    config.modResults.contents = gradle.replace(
      /(packagingOptions \{[\s\S]*?\n\s*\})/,
      (match) =>
        match +
        `\n    splits {\n        abi {\n            enable true\n            reset()\n            include "arm64-v8a"\n            universalApk false\n        }\n    }`
    );
    return config;
  });
}

module.exports = withArmOnly;
