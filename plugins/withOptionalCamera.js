const { withAndroidManifest } = require("expo/config-plugins");

/**
 * The CAMERA permission ("Take a photo" on Add from a picture) makes Android treat a camera as
 * required hardware unless the app says otherwise, and Google Play then hides the app from devices
 * without one (4.23.0 dropped 19). The camera is optional: without one, the gallery still works.
 */
const FEATURES = ["android.hardware.camera", "android.hardware.camera.autofocus"];

function withOptionalCamera(config) {
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

module.exports = withOptionalCamera;
