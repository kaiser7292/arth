import { BROKER_SETUP_GUIDES } from "../../constants/broker-setup-guides";

const textOf = (broker: keyof typeof BROKER_SETUP_GUIDES) => JSON.stringify(BROKER_SETUP_GUIDES[broker]);

describe("broker setup guides", () => {
  it("every step's text is unique within its guide, since it keys the row", () => {
    for (const guide of Object.values(BROKER_SETUP_GUIDES)) {
      const steps = guide.sections.flatMap((s) => s.steps.map((step) => step.text));
      expect(new Set(steps).size).toBe(steps.length);
    }
  });
  it("every guide names the app Arth and says it only reads or uses read-only permissions", () => {
    for (const broker of ["angel", "kite", "zebpay"] as const) {
      expect(textOf(broker)).toContain('"copy":"Arth"');
      expect(BROKER_SETUP_GUIDES[broker].sections[0].intro).toMatch(/only reads/);
    }
  });
  it("gives each broker its own redirect, and only Angel One the hosted one", () => {
    expect(textOf("angel")).toContain("https://integration.souravbaid.com/angelone/callback");
    // A Kite redirect carries the login token, so it must stay on the phone.
    expect(textOf("kite")).toContain('"copy":"https://127.0.0.1"');
    expect(textOf("kite")).not.toContain("souravbaid.com");
  });
  it("never publishes the owner's static IP", () => {
    for (const broker of ["angel", "kite", "zebpay"] as const) expect(textOf(broker)).not.toContain("129.154");
  });
  it("covers TOTP where it applies", () => {
    expect(textOf("angel")).toContain("Enable TOTP");
    expect(textOf("kite")).toContain("Enable External TOTP");
    expect(textOf("zebpay")).toContain("No TOTP is needed");
  });
  it("only links to https addresses", () => {
    for (const guide of Object.values(BROKER_SETUP_GUIDES)) {
      for (const section of guide.sections) for (const step of section.steps) if (step.link) expect(step.link.url).toMatch(/^https:\/\//);
    }
  });
});
