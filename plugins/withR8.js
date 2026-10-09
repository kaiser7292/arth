const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod, withGradleProperties } = require("expo/config-plugins");

/**
 * Turns on R8 for release builds (APK and Play AAB): code shrinking, optimisation and
 * obfuscation. Google Play flags apps below 25% obfuscation ("DEX code optimization is below
 * our threshold", deadline Feb 2027).
 *
 * - gradle.properties: android.enableMinifyInReleaseBuilds=true (Expo's build.gradle reads it)
 * - build.gradle: proguard-android.txt -> proguard-android-optimize.txt (the old default turns
 *   optimisation off)
 * - proguard-rules.pro: keep rules for native libraries that ship no R8 rules of their own and
 *   are reached by name from C++/JNI, from Android itself, or through the React Native bridge.
 *
 * Resource shrinking stays off: the widget and notification icons are looked up by name.
 * The R8 mapping file goes inside the AAB automatically, so Play can decode crash reports.
 */
const KEEP_RULES = `
# ARTH_R8_KEEP (plugins/withR8.js) - native libraries without their own R8 rules
-keep class com.souravbaid.arth.** { *; }
# SMS reading
-keep class com.react.SmsModule { *; }
-keep class com.react.SmsPackage { *; }
# Settings storage (MMKV)
-keep class com.mrousavy.mmkv.** { *; }
# Backup encryption
-keep class com.tectiv3.aes.** { *; }
# Home-screen widget (started by Android)
-keep class com.reactnativeandroidwidget.** { *; }
# PDF statement import (PdfBox loads fonts and filters by name)
-keep class expo.modules.pdfextractor.** { *; }
-keep class com.tom_roush.** { *; }
-dontwarn com.gemalto.jp2.**
-dontwarn org.bouncycastle.**
# WebView (Zerodha login) and voice input
-keep class com.reactnativecommunity.webview.** { *; }
-keep class expo.modules.speechrecognition.** { *; }
# Keep crash stack traces readable after decoding
-keepattributes SourceFile,LineNumberTable
# ARTH_R8_KEEP_END
`;

function withR8(config) {
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;
    const existing = props.find((p) => p.type === "property" && p.key === "android.enableMinifyInReleaseBuilds");
    if (existing) existing.value = "true";
    else props.push({ type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" });
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents.replace(
      'getDefaultProguardFile("proguard-android.txt")',
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
    // BouncyCastle (pulled in by PdfBox for password-protected PDFs) ships ~7.8 MB of data for
    // the Picnic and SIKE post-quantum schemes. R8 can't strip resource files; no PDF uses
    // either scheme (SIKE was broken in 2022), and R8 already removes Picnic's only reader.
    if (!gradle.includes("ARTH_PQC_EXCLUDES")) {
      gradle += `
// ARTH_PQC_EXCLUDES (plugins/withR8.js)
android {
    packaging {
        resources {
            excludes += ["org/bouncycastle/pqc/crypto/picnic/*.properties", "org/bouncycastle/pqc/crypto/sike/*.properties"]
        }
    }
}
`;
    }
    config.modResults.contents = gradle;
    return config;
  });

  return withDangerousMod(config, [
    "android",
    (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      let rules = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      rules = rules.replace(/\n# ARTH_R8_KEEP \(plugins\/withR8\.js\)[\s\S]*?# ARTH_R8_KEEP_END\n/, "\n");
      fs.writeFileSync(file, rules.trimEnd() + "\n" + KEEP_RULES);
      return config;
    },
  ]);
}

module.exports = withR8;
