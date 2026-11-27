import { isAiSetupPending } from "@/services/ai-share";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { mergeOffers, type MergeOffer } from "@/services/ai/tasks/merchant-merge";
import { templateOffers, type TemplateOffer } from "@/services/ai/tasks/graduate-template";
import { logger } from "@/utils/logger";

/**
 * What the AI has waiting for a decision, shown as cards in Catch Up (docs/AI_HUB_PROPOSAL.md §3):
 * your assistant's reply after a file was shared, message formats on-device AI can hand over to a
 * template, and merchant names it thinks are one place. Each part fails on its own: a broken
 * read leaves that part empty, never the whole deck.
 */
export interface CatchUpAiItems {
  replyWaiting: boolean;
  templates: { key: string; offer: TemplateOffer }[];
  merges: MergeOffer[];
}

export const NO_AI_ITEMS: CatchUpAiItems = { replyWaiting: false, templates: [], merges: [] };

export async function loadCatchUpAiItems(): Promise<CatchUpAiItems> {
  // A job switched off in "What else it does" stops asking, even about offers it saved before.
  const [templates, merges] = await Promise.all([
    (isAiJobOn("template") ? templateOffers() : Promise.resolve(new Map<string, TemplateOffer>()))
      .then((m) => [...m].map(([key, offer]) => ({ key, offer })))
      .catch((e) => {
        logger.warn("Catch up: template offers didn't load", e);
        return [];
      }),
    (isAiJobOn("merchant_merge") ? mergeOffers() : Promise.resolve([] as MergeOffer[])).catch((e) => {
      logger.warn("Catch up: merge offers didn't load", e);
      return [] as MergeOffer[];
    }),
  ]);
  return { replyWaiting: isAiSetupPending(), templates, merges };
}

export function countAiItems(items: CatchUpAiItems): number {
  return (items.replyWaiting ? 1 : 0) + items.templates.length + items.merges.length;
}
