import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Old route, kept for one release for links from notifications, help and search
 * (docs/AI_HUB_PROPOSAL.md §4): AI-assisted setup is now "Ask your AI assistant".
 */
export default function AiAssistedSetupRedirect() {
  const params = useLocalSearchParams<{ focus?: string }>();
  return <Redirect href={{ pathname: "/settings/ai-request", params: { focus: params.focus ?? "everything" } }} />;
}
