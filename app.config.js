const { execSync } = require("node:child_process");
const baseConfig = require("./app.json");

function getCommitSha() {
  // Prefer CI-provided SHA so the prebuilt APK matches its tag.
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  if (process.env.EXPO_PUBLIC_COMMIT_SHA) {
    return process.env.EXPO_PUBLIC_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

module.exports = () => {
  const commit = getCommitSha();
  return {
    ...baseConfig.expo,
    extra: {
      ...(baseConfig.expo.extra ?? {}),
      commitSha: commit,
    },
  };
};
