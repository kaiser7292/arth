/** iPhone: Settings says exactly why Apple Intelligence isn't available. */
let mockOs = "ios";
let mockPresent = true;
let mockReason: string | null = "turned-off";
jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockOs;
    },
  },
  AppState: { currentState: "active" },
}));
jest.mock("../../modules/arth-nano", () => ({
  get isNanoModulePresent() {
    return mockPresent;
  },
  checkNanoReason: async () => mockReason,
  checkNanoStatus: async () => "unavailable",
  downloadNano: async () => undefined,
  warmupNano: async () => undefined,
  generateWithNano: async () => ({ text: "", ms: 0 }),
}));

import { getOnDeviceReason, onDeviceReasonText } from "@/services/ai/nano";

describe("why Apple Intelligence isn't available", () => {
  beforeEach(() => {
    mockOs = "ios";
    mockPresent = true;
    mockReason = "turned-off";
  });

  it("a build without the module says so", async () => {
    mockPresent = false;
    expect(await getOnDeviceReason()).toBe("not-in-build");
    expect(onDeviceReasonText("not-in-build")).toContain("npx expo prebuild --platform ios");
  });

  it("passes on the iPhone's own reason", async () => {
    expect(await getOnDeviceReason()).toBe("turned-off");
    expect(onDeviceReasonText("turned-off")).toContain("Siri");
  });

  it("an answer it doesn't know, or none, is unknown", async () => {
    mockReason = "something-new";
    expect(await getOnDeviceReason()).toBe("unknown");
    mockReason = null;
    expect(await getOnDeviceReason()).toBe("unknown");
  });

  it("Android has no reason line", async () => {
    mockOs = "android";
    expect(await getOnDeviceReason()).toBeNull();
  });

  it("every reason has words", () => {
    for (const r of ["ready", "not-in-build", "built-without-sdk", "ios-too-old", "device-not-eligible", "turned-off", "getting-ready", "unknown"] as const) {
      expect(onDeviceReasonText(r).length).toBeGreaterThan(10);
    }
  });
});
