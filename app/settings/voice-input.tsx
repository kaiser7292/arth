import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { VoiceQuality } from "expo-speech";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getVoiceSettings, saveVoiceSettings } from "@/services/voice-settings";
import type { VoiceSettings } from "@/services/voice-settings";

interface DisplayVoice {
  identifier: string;
  language: string;
  friendlyName: string;
}

function regionOf(lang: string): string {
  const l = lang.toLowerCase();
  if (l.startsWith("en-in")) return "India";
  if (l.startsWith("en-us")) return "US";
  if (l.startsWith("en-gb")) return "UK";
  if (l.startsWith("en-au")) return "Australia";
  if (l.startsWith("en-nz")) return "NZ";
  if (l.startsWith("en-za")) return "South Africa";
  return "Other";
}

function regionOrder(lang: string): number {
  const order: Record<string, number> = { India: 0, US: 1, UK: 2, Australia: 3, NZ: 4, "South Africa": 5, Other: 6 };
  return order[regionOf(lang)] ?? 6;
}

function qualityOrder(v: Speech.Voice): number {
  // Enhanced beats Default; within same quality, "network" identifiers rank higher
  if (v.quality === VoiceQuality.Enhanced) return 0;
  if (v.identifier.includes("network")) return 1;
  return 2;
}

function qualityTag(v: Speech.Voice): string {
  if (v.quality === VoiceQuality.Enhanced) return " · HD";
  if (v.identifier.includes("network")) return " · Online";
  return "";
}

function genderOf(v: Speech.Voice): "female" | "male" | "unknown" {
  const text = `${v.name ?? ""} ${v.identifier}`.toLowerCase();
  if (text.includes("female")) return "female";
  if (text.includes("male")) return "male";
  return "unknown";
}

function buildDisplayVoices(raw: Speech.Voice[]): DisplayVoice[] {
  const english = raw.filter((v) => v.language.toLowerCase().startsWith("en"));
  const sorted = [...english].sort((a, b) => {
    const rd = regionOrder(a.language) - regionOrder(b.language);
    if (rd !== 0) return rd;
    return qualityOrder(a) - qualityOrder(b);
  });

  const females: Speech.Voice[] = [];
  const males: Speech.Voice[] = [];
  const unknown: Speech.Voice[] = [];
  for (const v of sorted) {
    const g = genderOf(v);
    if (g === "female") females.push(v);
    else if (g === "male") males.push(v);
    else unknown.push(v);
  }

  const result: DisplayVoice[] = [];
  let fn = 0, mn = 0, un = 0;
  for (const v of females.slice(0, 5)) {
    fn++;
    result.push({ identifier: v.identifier, language: v.language, friendlyName: `Female Voice ${fn}${qualityTag(v)}` });
  }
  for (const v of males.slice(0, 5)) {
    mn++;
    result.push({ identifier: v.identifier, language: v.language, friendlyName: `Male Voice ${mn}${qualityTag(v)}` });
  }
  const remaining = 10 - fn - mn;
  for (const v of unknown.slice(0, remaining)) {
    un++;
    result.push({ identifier: v.identifier, language: v.language, friendlyName: `Voice ${un}${qualityTag(v)}` });
  }
  return result; // max 10
}

export default function VoiceInputSettingsScreen() {
  const { accent, colors } = useColorScheme();
  const accentColor = accent[500];

  const [settings, setSettings] = useState<VoiceSettings>(getVoiceSettings);
  const [voices, setVoices] = useState<DisplayVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewingRef = useRef<string | null>(null);

  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((raw) => { setVoices(buildDisplayVoices(raw)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveVoiceSettings(next);
      return next;
    });
  }, []);

  const handlePreview = useCallback((voice: DisplayVoice) => {
    if (previewingRef.current === voice.identifier) {
      Speech.stop();
      previewingRef.current = null;
      setPreviewingId(null);
      return;
    }
    Speech.stop();
    previewingRef.current = voice.identifier;
    setPreviewingId(voice.identifier);
    Speech.speak("Hi, I'm your Arth voice assistant. I'll guide you through adding expenses.", {
      voice: voice.identifier,
      language: voice.language,
      onDone: () => {
        if (previewingRef.current === voice.identifier) {
          previewingRef.current = null;
          setPreviewingId(null);
        }
      },
      onError: () => { previewingRef.current = null; setPreviewingId(null); },
    });
  }, []);

  const selectedVoice = voices.find((v) => v.identifier === settings.voiceIdentifier);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Behaviour */}
        <Card title="Behaviour" className="mb-4">
          <View className="flex-row items-center justify-between py-1">
            <View className="flex-1 mr-4">
              <Text className="text-sm font-semibold text-foreground">
                Speak back questions
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {settings.speakBack
                  ? "Arth reads follow-up questions aloud while listening"
                  : "Questions appear as text only — silent mode"}
              </Text>
            </View>
            <Switch
              value={settings.speakBack}
              onValueChange={(v) => updateSettings({ speakBack: v })}
              trackColor={{ false: colors.border, true: accentColor }}
              thumbColor="#ffffff"
            />
          </View>
        </Card>

        {/* Voice sound */}
        <Card title="Voice Sound" className="mb-4">
          <Text className="text-xs text-muted-foreground mb-3">
            Tap Preview to hear a voice before selecting it. Voices come from your device's
            installed text-to-speech engine.
          </Text>

          {loading ? (
            <View className="py-6 items-center">
              <ActivityIndicator color={accentColor} />
              <Text className="text-xs text-faint-foreground mt-2">
                Loading voices…
              </Text>
            </View>
          ) : voices.length === 0 ? (
            <Text className="text-sm text-muted-foreground py-3 text-center">
              No English voices found. Install Google Text-to-Speech for more options.
            </Text>
          ) : (
            <>
              {/* System default */}
              {(() => {
                const isSelected = settings.voiceIdentifier === null;
                return (
                  <Pressable
                    onPress={() => updateSettings({ voiceIdentifier: null })}
                    className="flex-row items-center py-3 border-b border-border"
                  >
                    <View
                      className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3 flex-shrink-0"
                      style={{ borderColor: isSelected ? accentColor : colors.border }}
                    >
                      {isSelected && (
                        <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-sm font-medium text-foreground"
                        style={isSelected ? { color: accentColor } : undefined}
                      >
                        System Default
                      </Text>
                      <Text className="text-xs text-faint-foreground mt-0.5">
                        Uses your device's default TTS voice
                      </Text>
                    </View>
                  </Pressable>
                );
              })()}

              {voices.map((voice, i) => {
                const isSelected = settings.voiceIdentifier === voice.identifier;
                const isPreviewing = previewingId === voice.identifier;
                const isLast = i === voices.length - 1;
                return (
                  <Pressable
                    key={voice.identifier}
                    onPress={() => updateSettings({ voiceIdentifier: voice.identifier })}
                    className={`flex-row items-center py-3 ${isLast ? "" : "border-b border-border"}`}
                  >
                    <View
                      className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3 flex-shrink-0"
                      style={{ borderColor: isSelected ? accentColor : colors.border }}
                    >
                      {isSelected && (
                        <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
                      )}
                    </View>
                    <Text
                      className="text-sm font-medium text-foreground flex-1"
                      style={isSelected ? { color: accentColor } : undefined}
                    >
                      {voice.friendlyName}
                    </Text>
                    <Pressable
                      onPress={() => handlePreview(voice)}
                      hitSlop={8}
                      className="flex-row items-center px-3 py-1.5 rounded-full ml-2"
                      style={{ backgroundColor: isPreviewing ? `${accentColor}22` : `${accentColor}12` }}
                    >
                      <Ionicons
                        name={isPreviewing ? "stop-circle-outline" : "volume-high-outline"}
                        size={13}
                        color={accentColor}
                      />
                      <Text className="text-xs ml-1 font-medium" style={{ color: accentColor }}>
                        {isPreviewing ? "Stop" : "Preview"}
                      </Text>
                    </Pressable>
                  </Pressable>
                );
              })}

              {selectedVoice && (
                <Text className="text-xs text-faint-foreground mt-3 text-center">
                  Active: {selectedVoice.friendlyName}
                </Text>
              )}
            </>
          )}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
