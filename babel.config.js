module.exports = function (api) {
  // Re-evaluate per NODE_ENV so the test-only plugin below never reaches Metro builds.
  const isTest = api.env("test");
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      // Jest runs modules as CommonJS; a raw `import()` there throws
      // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG on current Node, which silently broke every
      // service that lazy-loads a dependency (`await import("@/database")` etc.) under test.
      // Turning it into a require() also lets jest.mock() intercept those modules.
      ...(isTest ? ["@babel/plugin-transform-dynamic-import"] : []),
      "react-native-reanimated/plugin",
    ],
  };
};
