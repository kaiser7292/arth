const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Signs release builds (APK and AAB) with the Arth release key instead of the
 * public React Native debug key.
 *
 * Key details are read at build time from a properties file OUTSIDE the repo:
 *   $ARTH_SIGNING_PROPERTIES, or ~/.arth/signing.properties by default
 * with keys: storeFile, storePassword, keyAlias, keyPassword.
 *
 * A release build without that file fails instead of silently falling back to
 * the debug key — a debug-signed APK can't update installs signed with the
 * release key. Set ARTH_ALLOW_DEBUG_SIGNING=1 to override (e.g. a throwaway
 * build on another machine). Debug builds are unaffected.
 */
const MARKER = "// Arth release signing (plugins/withReleaseSigning.js)";

const LOADER = `${MARKER}
def arthSigningPath = System.getenv("ARTH_SIGNING_PROPERTIES") ?: "\${System.getProperty('user.home')}/.arth/signing.properties"
def arthSigningFile = new File(arthSigningPath)
def arthSigningProps = null
if (arthSigningFile.exists()) {
    arthSigningProps = new Properties()
    arthSigningFile.withInputStream { arthSigningProps.load(it) }
}
gradle.taskGraph.whenReady { graph ->
    def releaseTask = graph.allTasks.any { it.name ==~ /(assemble|bundle|package)Release/ }
    if (releaseTask && arthSigningProps == null) {
        if (System.getenv("ARTH_ALLOW_DEBUG_SIGNING") == "1") {
            logger.warn("WARNING: \${arthSigningPath} not found - release build is signed with the PUBLIC debug key")
        } else {
            throw new GradleException("Release signing file not found: \${arthSigningPath}. See .context/BUILD_AND_RELEASE.md (Release signing).")
        }
    }
}

`;

const RELEASE_CONFIG = `
        if (arthSigningProps != null) {
            release {
                storeFile file(arthSigningProps['storeFile'])
                storePassword arthSigningProps['storePassword']
                keyAlias arthSigningProps['keyAlias']
                keyPassword arthSigningProps['keyPassword']
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    // Idempotency guard
    if (gradle.includes(MARKER)) return config;

    // 1. Load the properties file before the android block
    gradle = gradle.replace(/^android \{/m, (match) => LOADER + match);

    // 2. Add signingConfigs.release after the debug signing config
    gradle = gradle.replace(
      /(signingConfigs \{\s*\n\s*debug \{[\s\S]*?\n\s*\})/,
      (match) => match + RELEASE_CONFIG
    );

    // 3. Point the release build type at it
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      (_, before) =>
        before + "signingConfig arthSigningProps != null ? signingConfigs.release : signingConfigs.debug"
    );

    if (!gradle.includes("signingConfigs.release :") || !gradle.includes("arthSigningProps['storeFile']")) {
      throw new Error("withReleaseSigning: build.gradle layout changed; could not insert release signing");
    }

    config.modResults.contents = gradle;
    return config;
  });
}

module.exports = withReleaseSigning;
