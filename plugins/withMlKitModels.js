const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * One ML Kit model list for the app. Two libraries each ask Play services to download their model at
 * install time through the same meta-data key: our text reader ("ocr", modules/arth-text-reader) and
 * expo-camera's QR scanner ("barcode_ui"). Android can't merge two values for one key, so the app's
 * manifest (which wins over libraries) sets both.
 */
const KEY = "com.google.mlkit.vision.DEPENDENCIES";
const VALUE = "ocr,barcode_ui";

function withMlKitModels(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    manifest.manifest.$["xmlns:tools"] = manifest.manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app["meta-data"] = (app["meta-data"] || []).filter((m) => m.$["android:name"] !== KEY);
    app["meta-data"].push({ $: { "android:name": KEY, "android:value": VALUE, "tools:replace": "android:value" } });
    return config;
  });
}

module.exports = withMlKitModels;
