import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LoadingState, ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  getUserTemplate,
  type UserSmsTemplate,
} from "@/services/sms/user-sms-templates";
import { startDraft } from "@/services/sms/template-draft-store";
import { compileTemplate, deriveSpansFromRegex } from "@/services/sms/template-compiler";
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
  const { id } = useLocalSearchParams<{ id: string }>();
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
        const restoredSpans =
          sampleBody.length > 0
            ? deriveSpansFromRegex(t.pattern_regex, sampleBody) ?? []
            : [];
        // Detect if the stored regex was manually edited by comparing against
        // what auto-compile would produce from the restored spans.
        let isManualRegex = false;
        let manualRegexValue: string | null = null;
        if (restoredSpans.length > 0 && sampleBody.length > 0) {
          const autoCompiled = compileTemplate({ smsBody: sampleBody, spans: restoredSpans });
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
