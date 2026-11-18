const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// The preview harness (ARTH_PREVIEW=1, web) renders components without a database: swap
// expo-sqlite for a stub so its web build (which needs a wasm file) is never bundled.
if (process.env.ARTH_PREVIEW === "1") {
  const stub = path.join(__dirname, "preview-kit", "expo-sqlite-stub.js");
  const resolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "expo-sqlite") return { type: "sourceFile", filePath: stub };
    return resolve ? resolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = withNativeWind(config, { input: "./global.css" });
