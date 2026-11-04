/** What to say when every Angel One request failed, using Angel One's own words when it gave any. */
export function angelFailureMessage(parts: { sessionEnded: boolean; reason: string | null }[]): string {
  const reason = parts.find((p) => p.reason)?.reason ?? null;
  if (parts.some((p) => p.sessionEnded)) {
    return `Angel One didn't accept the sign-in${reason ? ` (${reason})` : ""}. Check your details under Update credentials.`;
  }
  if (reason) return `Angel One said: ${reason}. Check your details under Update credentials.`;
  return "Couldn't reach Angel One. Your last synced data is still here. Try again in a moment.";
}
