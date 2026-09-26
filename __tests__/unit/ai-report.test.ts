import {
  AI_REPORT_EMAIL,
  buildAIReportBody,
  buildAIReportMailto,
} from "../../services/ai-report";

const base = {
  reason: "offensive" as const,
  question: "How much did I spend on food?",
  answer: "You spent ₹4,200 & more.",
  modelName: "Llama 3.2 1B",
  appVersion: "4.1.8",
};

describe("ai-report", () => {
  it("includes reason, question, answer, model and version in the body", () => {
    const body = buildAIReportBody({ ...base, note: "rude tone" });
    expect(body).toContain("Reason: Offensive or harmful");
    expect(body).toContain("Note: rude tone");
    expect(body).toContain("How much did I spend on food?");
    expect(body).toContain("You spent ₹4,200 & more.");
    expect(body).toContain("Model: Llama 3.2 1B");
    expect(body).toContain("App version: 4.1.8");
  });

  it("omits an empty note and marks a missing question", () => {
    const body = buildAIReportBody({ ...base, note: "  ", question: null });
    expect(body).not.toContain("Note:");
    expect(body).toContain("(none)");
  });

  it("truncates very long answers", () => {
    const body = buildAIReportBody({ ...base, answer: "x".repeat(5000) });
    expect(body).toContain("[truncated]");
    expect(body.length).toBeLessThan(2500);
  });

  it("builds an encoded mailto URL that round-trips", () => {
    const url = buildAIReportMailto(base);
    expect(url.startsWith(`mailto:${AI_REPORT_EMAIL}?subject=`)).toBe(true);
    const body = new URLSearchParams(url.split("?")[1]).get("body");
    expect(body).toBe(buildAIReportBody(base));
  });
});
