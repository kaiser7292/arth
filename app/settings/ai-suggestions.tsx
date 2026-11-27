import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Old route, kept for one release (docs/AI_HUB_PROPOSAL.md §4): every assistant reply, setup ones
 * included, is now checked and applied on "Ask your AI assistant", which keeps a copy for Undo.
 * paste, onboarding and local are passed on unchanged.
 */
export default function AiSuggestionsRedirect() {
  const params = useLocalSearchParams<{ paste?: string; onboarding?: string; local?: string }>();
  const pass = Object.fromEntries(Object.entries(params).filter(([k, v]) => ["paste", "onboarding", "local"].includes(k) && typeof v === "string"));
  return <Redirect href={{ pathname: "/settings/ai-request", params: pass }} />;
}
