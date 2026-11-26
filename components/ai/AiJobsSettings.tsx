import { useCallback, useState } from "react";
import { Switch, View } from "react-native";
import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { AI_JOBS, isAiJobSwitchOn, setAiJobSwitch, type AiJobKey } from "@/services/ai/ai-reading";
import { acceptTemplateOffer, dismissTemplateOffer, templateOffers, type TemplateOffer } from "@/services/ai/tasks/graduate-template";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";

/**
 * Settings → On-device AI: a switch per job (services/ai/ai-reading.ts AI_JOBS), and message
 * formats ready to hand over to a template (job 3).
 */
export function AiJobsSettings() {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(AI_JOBS.map((j) => [j.key, isAiJobSwitchOn(j.key)])));
  const [offers, setOffers] = useState<[string, TemplateOffer][]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setOffers([...(await templateOffers().catch(() => new Map<string, TemplateOffer>()))]);
    }, []),
  );

  const toggle = (key: AiJobKey, v: boolean) => {
    setOn((s) => ({ ...s, [key]: v }));
    setAiJobSwitch(key, v);
  };

  const answer = async (key: string, offer: TemplateOffer, yes: boolean) => {
    if (busy) return;
    setBusy(key);
    try {
      if (yes) {
        const { read } = await acceptTemplateOffer(key, offer);
        setNote(`Arth reads ${offer.label} by itself now${read > 0 ? `, and read ${read} waiting message${read === 1 ? "" : "s"}` : ""}.`);
      } else {
        await dismissTemplateOffer(key);
      }
      setOffers((list) => list.filter(([k]) => k !== key));
      bumpDataVersion();
    } catch (e) {
      logger.warn("Template offer failed", e);
      setNote("Couldn't save the template. You can teach this format by hand in Message templates.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {(offers.length > 0 || note) && (
        <>
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Formats ready to learn</Text>
          <Card className="mb-4">
            {offers.map(([key, o], i) => (
              <View key={key} className={i > 0 ? "pt-3 mt-3 border-t border-border" : ""}>
                <Text className="text-sm font-semibold text-foreground">{o.label}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                  You approved two of these the AI read. Arth can read them by itself from now on, instantly.
                </Text>
                <View className="flex-row mt-2" style={{ gap: 8 }}>
                  <Button title="Yes, read them" onPress={() => void answer(key, o, true)} loading={busy === key} className="flex-1" />
                  <Button title="Not now" variant="outline" onPress={() => void answer(key, o, false)} className="flex-1" />
                </View>
              </View>
            ))}
            {note && <Text className="text-xs text-muted-foreground mt-2">{note}</Text>}
          </Card>
        </>
      )}

      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">What else it does</Text>
      <Card className="mb-4">
        {AI_JOBS.map((j, i) => (
          <View key={j.key} className={`flex-row items-center${i > 0 ? " pt-3 mt-3 border-t border-border" : ""}`}>
            <View className="flex-1 mr-3">
              <Text className="text-sm font-semibold text-foreground">{j.label}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5 leading-4">{j.note}</Text>
            </View>
            <Switch value={on[j.key] !== false} onValueChange={(v) => toggle(j.key, v)} accessibilityLabel={j.label} />
          </View>
        ))}
      </Card>
    </>
  );
}
