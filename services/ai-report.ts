/**
 * "Report this answer" for Arth AI.
 *
 * Google Play's AI-generated content policy requires an in-app way to report
 * offensive AI output. Arth has no server, so a report is an email the user
 * reviews and sends from their own mail app — nothing leaves the phone
 * without them tapping Send.
 */

export const AI_REPORT_EMAIL = "souravbaid270@gmail.com";

export type AIReportReason = "offensive" | "wrong" | "other";

export const AI_REPORT_REASONS: Array<{ id: AIReportReason; label: string }> = [
  { id: "offensive", label: "Offensive or harmful" },
  { id: "wrong", label: "Wrong or misleading" },
  { id: "other", label: "Something else" },
];

// Some mail apps silently truncate very long mailto: URIs.
const MAX_FIELD_CHARS = 1500;

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_FIELD_CHARS ? `${t.slice(0, MAX_FIELD_CHARS)}… [truncated]` : t;
}

export interface AIReportInput {
  reason: AIReportReason;
  note?: string;
  question: string | null;
  answer: string;
  modelName: string;
  appVersion: string;
}

export function buildAIReportBody(input: AIReportInput): string {
  const reasonLabel = AI_REPORT_REASONS.find((r) => r.id === input.reason)?.label ?? input.reason;
  const lines = [
    `Reason: ${reasonLabel}`,
    input.note?.trim() ? `Note: ${input.note.trim()}` : null,
    "",
    "Question:",
    input.question ? clip(input.question) : "(none)",
    "",
    "Arth AI answer:",
    clip(input.answer),
    "",
    `Model: ${input.modelName}`,
    `App version: ${input.appVersion}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function buildAIReportMailto(input: AIReportInput): string {
  const subject = "Arth AI answer report";
  return `mailto:${AI_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildAIReportBody(input))}`;
}
