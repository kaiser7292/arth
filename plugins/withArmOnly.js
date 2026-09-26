const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

/**
 * Restricts release builds (APK and Play AAB) to arm64-v8a.
 * Cuts the APK from ~210 MB to ~120 MB by dropping 32-bit and x86 libraries.
 * All modern Android phones (2015+) support arm64-v8a; 32-bit-only phones
 * show "not compatible" on Play.
 *
 * How: pin reactNativeArchitectures=arm64-v8a in gradle.properties. The React
 * Native gradle plugin then sets ndk.abiFilters from it, which filters BOTH our
 * compiled code and the prebuilt .so files inside dependency AARs (Hermes,
 * libreactnative, fbjni…), for the APK and the AAB alike.
 *
 * This plugin used to enable APK ABI splits instead. Splits don't apply to the
 * AAB, and while they are on the RN plugin skips abiFilters — so the AAB shipped
 * all four ABIs. Any leftover splits block from an older prebuild is removed.
 * Never add splits back alongside abiFilters: they conflict in AGP 8+.
 */
function withArmOnly(config) {
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;
    const existing = props.find((p) => p.type === "property" && p.key === "reactNativeArchitectures");
    if (existing) existing.value = "arm64-v8a";
    else props.push({ type: "property", key: "reactNativeArchitectures", value: "arm64-v8a" });
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents
      .replace(/\n\s*splits \{\s*\n\s*abi \{[\s\S]*?\n\s*\}\s*\n\s*\}/, "")
      // Short-lived jniLibs.excludes attempt (RN's pickFirsts override excludes)
      .replace(/\n\/\/ ARTH_NON_ARM64_EXCLUDES[\s\S]*?\n\}\n/, "\n");

    // Keep the release APK named app-arm64-v8a-release.apk (the name splits used to
    // produce): the website's download buttons link to that GitHub release asset.
    if (!gradle.includes("ARTH_APK_NAME")) {
      gradle += `
// ARTH_APK_NAME (plugins/withArmOnly.js)
android.applicationVariants.all { variant ->
    if (variant.buildType.name == "release") {
        variant.outputs.all { outputFileName = "app-arm64-v8a-release.apk" }
    }
}
`;
    }

    config.modResults.contents = gradle;
    return config;
  });
}

module.exports = withArmOnly;
