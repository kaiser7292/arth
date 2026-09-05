import { useCallback, useEffect, useState } from "react";
import { View, TextInput, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  startDraft,
  updateDraft,
  getDraft,
  clearDraft,
} from "@/services/sms/template-draft-store";
import { resolveBankFromSender } from "@/services/public-data/lookup";

/**
 * v15.6.0 — "Paste SMS" screen.
 *
 * Entry from:
 *   - Settings → Smart SMS Templates → + FAB (fresh draft)
 *   - Unrecognised SMS browser → Teach this (prefilled draft)
 *
 * Params:
 *   prefilledBody?: string
 *   smsId?: string  (pending_sms.id — stamped into the template as
 *                   created_from_sms_id on save)
 *   senderAddress?: string  (pending_sms.address — resolved to a bank name
 *                            hint on the next screen)
 *
 * Changes in v15.6.0:
 *   - If a draft is found from a previous session (stale after app restart),
 *     show a "resume or discard" banner.
 *   - When smsId + senderAddress are provided, the sender is resolved against
 *     the bank registry and stored in the draft as `bankName` — the tag screen
 *     picks it up automatically.
 */
export default function PasteSmsScreen() {
  const router = useRouter();
  const { prefilledBody, smsId, senderAddress } = useLocalSearchParams<{
    prefilledBody?: string;
    smsId?: string;
    senderAddress?: string;
  }>();
  const { colors } = useColorScheme();

  const existingDraft = getDraft();
  const hasStaleDraft =
    !prefilledBody &&
    !smsId &&
    existingDraft != null &&
    (existingDraft.smsBody.length > 0 || existingDraft.spans.length > 0);

  const [body, setBody] = useState<string>(() => {
    if (prefilledBody) return prefilledBody;
    return existingDraft?.smsBody ?? "";
  });

  useEffect(() => {
    if (prefilledBody || smsId) {
      // v15.11.0: pre-fill sender pattern if we came in from a pending_sms row
      // with a known address. Extract the [A-Z]{4,} run (DLT code) — that's
      // the default `code` mode's pattern. Users can change the mode on the
      // tagger screen.
      const senderCode =
        senderAddress?.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? "";
      startDraft({
        smsBody: prefilledBody ?? "",
        createdFromSmsId: smsId ?? null,
        senderPattern: senderCode,
        senderMatchMode: "code",
      });
      // Try to resolve the sender to a bank name so the user doesn't need
      // to type it. Updates draft in place.
      if (senderAddress) {
        (async () => {
          try {
            const bank = await resolveBankFromSender(senderAddress);
            if (bank) updateDraft({ bankName: bank });
          } catch {
            // Silent — bank resolution is a hint, not required.
          }
        })();
      }
    } else if (!existingDraft) {
      startDraft({ smsBody: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNext = useCallback(() => {
    const trimmed = body.trim();
    if (trimmed.length < 10) return;
    updateDraft({ smsBody: trimmed });
    router.push("/settings/sms-templates/tag" as never);
  }, [body, router]);

  const handleDiscard = useCallback(() => {
    clearDraft();
    startDraft({ smsBody: "" });
    setBody("");
  }, []);

  const canProceed = body.trim().length >= 10;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {hasStaleDraft && (
          <Card className="mb-3">
            <View className="flex-row items-start">
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              <View className="flex-1 ml-2">
                <Text className="text-sm font-semibold text-foreground">
                  Resume unfinished template?
                </Text>
                <Text className="text-xs text-faint-foreground mt-0.5">
                  You started teaching Arth an SMS earlier but didn't save. Continue where you left off, or discard and start over.
                </Text>
                <View className="flex-row mt-2" style={{ gap: 8 }}>
                  <Pressable
                    onPress={() => router.push("/settings/sms-templates/tag" as never)}
                    className="flex-1 items-center py-2 rounded-lg"
                    style={{ backgroundColor: colors.tint }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: "#FFFFFF" }}>
                      Continue
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDiscard}
                    className="flex-1 items-center py-2 rounded-lg"
                    style={{ borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: colors.text }}>
                      Discard
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Card>
        )}

        <Card className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-2">
            Paste an SMS Arth couldn't read
          </Text>
          <Text className="text-xs text-faint-foreground mb-3">
            Copy the raw SMS from your Messages app. Include the whole body so Arth can learn the format.
          </Text>
          <TextInput
            multiline
            value={body}
            onChangeText={setBody}
            placeholder="Paste the SMS here…"
            placeholderTextColor={colors.textSecondary}
            style={{
              minHeight: 160,
              maxHeight: 260,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              color: colors.text,
              backgroundColor: colors.background,
              textAlignVertical: "top",
            }}
          />
          <Text className="text-xs text-faint-foreground mt-2 mb-3">
            Tip: long-press inside the text box and tap Paste.
          </Text>
          <Button title="Next" onPress={handleNext} disabled={!canProceed} />
        </Card>

        <Text className="text-xs text-faint-foreground px-2">
          ⚠️ The SMS body is stored on your device with the template so Arth can show it back to you later. If the SMS contains sensitive details (full account numbers, OTPs), remove them before pasting.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
