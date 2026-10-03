import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LoadingState, ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  getUserTemplate,
  parseSamples,
  parseWordRules,
  type UserSmsTemplate,
} from "@/services/sms/user-sms-templates";
import { startDraft } from "@/services/sms/template-draft-store";
import { autoTag, compileTemplate, deriveSpansFromRegex } from "@/services/sms/template-compiler";
import { useTheme } from "@/hooks/use-theme";

/**
 * v15.6.0 — Edit an existing user SMS template.
 *
 * Thin hand-off: load the template, pre-fill the draft store, then
 * router.replace to the tag screen.
 *
 * Changes in v15.6.0: previous tag positions are now restored via
 * deriveSpansFromRegex — the user sees their previous tags highlighted and
 * only has to re-tag what's wrong. Falls back to empty spans if the derive
 * fails (e.g. the stored regex is too obfuscated to reverse-map).
 */
export default function EditSmsTemplateScreen() {
  const router = useRouter();
  // addExample: a message from Unrecognised to add to this template as another example.
  const { id, addExample } = useLocalSearchParams<{ id: string; addExample?: string }>();
  const alert = useAlert();
  
  const theme = useTheme();
  const accentColor = theme.primary;

  const [, setTemplate] = useState<UserSmsTemplate | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const t = await getUserTemplate(id);
        if (!t) {
          alert("Template not found", "It may have been deleted.");
          router.back();
          return;
        }
        setTemplate(t);
        const sampleBody = t.sample_sms ?? "";
        // Templates saved since migration 081 keep their taps; older ones are reverse-mapped.
        const samples = parseSamples(t.samples);
        const storedFirst = samples[0]?.body === sampleBody ? samples[0].spans : null;
        const restoredSpans =
          storedFirst ??
          (sampleBody.length > 0 ? deriveSpansFromRegex(t.pattern_regex, sampleBody) ?? [] : []);
        // A template with more than one example is flexible by definition.
        let matchStyle = t.match_style ?? "exact";
        const wordRules = parseWordRules(t.word_rules);
        const extraSamples = samples.slice(1);
        if (addExample && addExample !== sampleBody && !extraSamples.some((x) => x.body === addExample)) {
          extraSamples.push({
            body: addExample,
            spans: deriveSpansFromRegex(t.pattern_regex, addExample) ?? autoTag(addExample),
          });
          matchStyle = "flexible";
        }
        // Detect if the stored regex was manually edited by comparing against
        // what auto-compile would produce from the restored spans.
        let isManualRegex = false;
        let manualRegexValue: string | null = null;
        if (restoredSpans.length > 0 && sampleBody.length > 0) {
          const autoCompiled = compileTemplate({
            smsBody: sampleBody,
            spans: restoredSpans,
            style: matchStyle,
            wordRules,
            extraSamples: samples.slice(1).map((x) => ({ smsBody: x.body, spans: x.spans })),
          });
          if (autoCompiled.ok && autoCompiled.patternRegex !== t.pattern_regex) {
            isManualRegex = true;
            manualRegexValue = t.pattern_regex;
          }
        }
        startDraft({
          editingId: t.id,
          smsBody: sampleBody,
          spans: restoredSpans,
          bankName: t.bank_name,
          txType: t.tx_type,
          label: t.template_id ?? "",
          createdFromSmsId: t.created_from_sms_id,
          senderPattern: t.sender_pattern ?? "",
          senderMatchMode: t.sender_match_mode ?? "code",
          useManualRegex: isManualRegex,
          manualRegex: manualRegexValue,
          defaultPaymentModeId: t.default_payment_mode_id ?? null,
          matchStyle,
          wordRules,
          extraSamples,
        });
        router.replace("/settings/sms-templates/tag");
      } catch (e) {
        alert(
          "Couldn't load template",
          e instanceof Error ? e.message : String(e),
        );
        router.back();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <ScreenContainer padTop={false}>
      <LoadingState />
    </ScreenContainer>
  );
}
