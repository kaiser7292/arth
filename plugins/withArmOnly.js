const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Restricts the build to arm64-v8a only.
 * Cuts build time significantly by skipping armeabi-v7a, x86, and x86_64.
 * All modern Android phones (2015+) support arm64-v8a.
 */
function withArmOnly(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (gradle.includes('abiFilters "arm64-v8a"')) return config;

    config.modResults.contents = gradle.replace(
      /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL".*\n(\s*})/,
      (match, closing) =>
        match.replace(
          closing,
          `\n        ndk {\n            abiFilters "arm64-v8a"\n        }\n    }`
        )
    );
    return config;
  });
}

module.exports = withArmOnly;
