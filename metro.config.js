const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// pdfjs-dist v6 ships ESM-only (.mjs) files; Metro needs to know to process them
config.resolver.sourceExts = [...config.resolver.sourceExts, "mjs"];

module.exports = withNativeWind(config, { input: "./global.css" });
