const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

/**
 * Android: shares (SEND / SEND_MULTIPLE) go to a small ShareTargetActivity that forwards them to
 * MainActivity in Arth's own task (see plugins/android/ShareTargetActivity.kt for why). The share
 * filters expo-share-intent puts on MainActivity are moved onto it; MainActivity keeps its
 * launcher, deep-link and backup-file filters.
 *
 * List it just BEFORE "expo-share-intent" in app.json's plugins: manifest mods run in reverse
 * order, so it then runs after expo-share-intent has added the filters it moves.
 */
const FILE_NAME = "ShareTargetActivity.kt";
const SHARE_ACTIONS = new Set(["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"]);

function isShareFilter(filter) {
  return (filter.action ?? []).some((a) => SHARE_ACTIONS.has(a.$["android:name"]));
}

function withShareTarget(config) {
  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    const activities = application.activity ?? [];
    const main = activities.find((a) => a.$["android:name"] === ".MainActivity");
    if (!main) throw new Error("withShareTarget: .MainActivity not found in AndroidManifest.xml");

    const shareFilters = (main["intent-filter"] ?? []).filter(isShareFilter);
    if (shareFilters.length === 0) {
      throw new Error("withShareTarget: no share filters on .MainActivity - list it before expo-share-intent in app.json");
    }
    main["intent-filter"] = main["intent-filter"].filter((f) => !isShareFilter(f));

    application.activity = activities.filter((a) => a.$["android:name"] !== ".ShareTargetActivity");
    application.activity.push({
      $: {
        "android:name": ".ShareTargetActivity",
        "android:exported": "true",
        "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
        "android:excludeFromRecents": "true",
        "android:noHistory": "true",
        "android:taskAffinity": "",
      },
      "intent-filter": shareFilters,
    });
    return cfg;
  });

  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error("withShareTarget: expo.android.package is not set");
      const source = fs
        .readFileSync(path.join(__dirname, "android", FILE_NAME), "utf8")
        .replace(/^package .*$/m, `package ${pkg}`);
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "java", ...pkg.split("."));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE_NAME), source);
      return cfg;
    },
  ]);
}

module.exports = withShareTarget;
