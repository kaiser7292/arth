import { useCallback, useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { bumpDataVersion } from "@/services/settings";
import { acceptMergeOffer, dismissMergeOffer, mergeOffers, type MergeOffer } from "@/services/ai/tasks/merchant-merge";
import { logger } from "@/utils/logger";
import { withMerchantUndo } from "@/services/merchant-undo";

/**
 * "Same place?" (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 2): merchant names on-device AI thinks
 * are one place. Merge keeps the name with more transactions; "Not the same" is remembered.
 * Shows nothing when there's nothing to ask, or the offers can't be read.
 */
export function MergeOffersCard() {
  const theme = useTheme();
  const [offers, setOffers] = useState<MergeOffer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setOffers(await mergeOffers().catch(() => []));
    }, []),
  );

  const answer = async (o: MergeOffer, merge: boolean) => {
    if (busy) return;
    setBusy(o.key);
    try {
      if (merge) {
        // Undoable like every other merge: the Merchants screen's Undo bar shows this message.
        await withMerchantUndo(
          () => acceptMergeOffer(o),
          (moved) => `${o.other.name} now shows as ${o.keep.name}${moved > 0 ? ` (${moved} transaction${moved === 1 ? "" : "s"})` : ""}`,
        );
      } else {
        await dismissMergeOffer(o.key);
      }
      setOffers((list) => list.filter((x) => x.key !== o.key));
      bumpDataVersion();
    } catch (e) {
      logger.warn("Merge offer failed", e);
      setNote("Couldn't do that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (offers.length === 0 && !note) return null;
  return (
    <Card className="mb-3">
      <View className="flex-row items-center mb-1">
        <Ionicons name="sparkles-outline" size={16} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground ml-2">Same place?</Text>
      </View>
      <Text className="text-xs text-muted-foreground mb-2 leading-5">On-device AI thinks these names are one place. Merging changes the names only.</Text>
      {offers.slice(0, 3).map((o) => (
        <View key={o.key} className="py-2 border-t border-border">
          <Text className="text-sm text-foreground">
            {o.other.name} <Text className="text-sm text-muted-foreground">→</Text> {o.keep.name}
          </Text>
          <View className="flex-row mt-2" style={{ gap: 8 }}>
            <Button title="Merge" onPress={() => void answer(o, true)} loading={busy === o.key} className="flex-1" />
            <Button title="Not the same" variant="outline" onPress={() => void answer(o, false)} className="flex-1" />
          </View>
        </View>
      ))}
      {note && <Text className="text-xs text-muted-foreground mt-2">{note}</Text>}
    </Card>
  );
}
