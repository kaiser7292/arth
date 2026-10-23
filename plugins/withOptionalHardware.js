const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Hardware Arth can use but doesn't need. A permission implies its hardware as required unless the
 * app says otherwise, and Google Play then hides the app from devices without it:
 *   - READ_SMS implies telephony: Wi-Fi-only tablets (e.g. Galaxy Tab S8) couldn't install Arth.
 *     Without it there are simply no messages to read; everything else works.
 *   - CAMERA ("Take a photo" on Add from a picture) implies a camera: 4.23.0 dropped 19 devices.
 *     Without one, the gallery still works.
 *   - RECORD_AUDIO (voice entry and voice search) implies a microphone. Without one, type instead.
 */
const FEATURES = [
  "android.hardware.telephony",
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.microphone",
];

function withOptionalHardware(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const features = (manifest["uses-feature"] = manifest["uses-feature"] ?? []);
    for (const name of FEATURES) {
      const existing = features.find((f) => f.$?.["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else features.push({ $: { "android:name": name, "android:required": "false" } });
    }
    return config;
  });
}

module.exports = withOptionalHardware;
