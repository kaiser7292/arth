const {
  withEntitlementsPlist,
  withPodfile,
  withXcodeProject,
} = require("expo/config-plugins");

/**
 * Lets the iOS project build with Xcode 27 and sign with a free Apple ID.
 *
 * 1. Drops the Push Notifications entitlement that expo-notifications adds.
 *    Arth only schedules local notifications (no server), and free
 *    "Personal Team" Apple IDs can't sign an app that has it.
 * 2. Raises pods still targeting iOS < 15.1 (react-native-svg's RNSVGFilters
 *    bundle says 12.4); Xcode 27 refuses to build anything below 15.0.
 * 3. Turns off User Script Sandboxing, which stops the "Bundle React Native
 *    code and images" phase from writing main.jsbundle (EPERM).
 *
 * Keep this near the TOP of app.json's plugin list: Expo runs mods in reverse
 * order, so listing it before expo-notifications makes the entitlement delete
 * run after expo-notifications has added it.
 */
const MARKER = "# Arth iOS build fixes (plugins/withIosBuildFixes.js)";

const POD_FIX = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        dt = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1' if dt && dt.to_f < 15.1
      end
    end`;

function withIosBuildFixes(config) {
  config = withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });

  config = withPodfile(config, (config) => {
    const podfile = config.modResults.contents;
    if (!podfile.includes(MARKER)) {
      config.modResults.contents = podfile.replace(
        /(react_native_post_install\([\s\S]*?\n\s*\))/,
        `$1${POD_FIX}`
      );
    }
    return config;
  });

  return withXcodeProject(config, (config) => {
    const configs = config.modResults.pbxXCBuildConfigurationSection();
    // Set explicitly, not just when present: the template leaves it unset and
    // Xcode's "recommended settings" upgrade then turns it on.
    for (const key of Object.keys(configs)) {
      const settings = configs[key].buildSettings;
      if (settings) settings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
    }
    return config;
  });
}

module.exports = withIosBuildFixes;
