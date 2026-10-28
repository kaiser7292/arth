import { View } from "react-native";

import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * iPhone: the Shortcuts automation that hands each bank message to Arth, step by step. One
 * automation for every message: "Add bank message to Arth" drops anything that isn't a transaction
 * (chats, OTPs, offers) on the phone, unsaved, so there's no keyword to choose.
 *
 * Wording follows the Shortcuts app on iOS 17 to 26. "Notify When Run" is gone on newer iOS, so
 * step 3 only mentions it as "if you see it".
 */
export const SHORTCUT_SETUP_STEPS: { title: string; body: string }[] = [
  { title: "Open Shortcuts", body: "Go to the Automation tab, tap +, and choose Message." },
  {
    title: "Leave the filters empty",
    body: 'Leave Sender and "Message Contains" empty, so every bank works. Arth ignores anything that isn\'t a transaction, chats and OTPs included, without saving it. One automation is enough: extra ones (like "Rs" or "INR") hand the same message over twice.',
  },
  {
    title: "Let it run by itself",
    body: 'Choose "Run Immediately" and tap Next. If you see "Notify When Run", turn it off (newer iOS doesn\'t have it). iOS may still show a short "Running your automation" notice: that comes from iOS, not Arth.',
  },
  {
    title: "Hand it to Arth",
    body: 'Tap "New Blank Automation" and add the action "Add bank message to Arth" (search for Arth). Tap the light-blue Message and pick Shortcut Input, then tap Done. If you\'re asked to paste the message every time, this is the step to fix.',
  },
];

export function ShortcutSetupSteps() {
  const theme = useTheme();
  return (
    <>
      {SHORTCUT_SETUP_STEPS.map((s, i) => (
        <View key={s.title} className="flex-row py-2">
          <View
            className="w-6 h-6 rounded-full items-center justify-center mr-3 mt-0.5"
            style={{ backgroundColor: theme.alpha("primary", 0.12) }}
          >
            <Text className="text-xs font-semibold" style={{ color: theme.primary }}>{i + 1}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground">{s.title}</Text>
            <Text className="text-xs text-muted-foreground mt-0.5 leading-4">{s.body}</Text>
          </View>
        </View>
      ))}
    </>
  );
}
