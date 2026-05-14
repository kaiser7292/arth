import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AlertSeverity } from "@/utils/course-correction";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";

interface AlertBannerProps {
  severity: AlertSeverity;
  message: string;
  onDismiss?: () => void;
}

const SEVERITY_CONFIG_BASE = {
  info: {
    bg: "#EFF6FF",
    bgDark: "#1E293B",
    text: "#1E40AF",
    textDark: "#93C5FD",
    icon: "information-circle-outline" as const,
  },
  warning: {
    bg: "#FEF9E7",
    bgDark: "#332B00",
    text: "#92400E",
    icon: "alert-circle-outline" as const,
  },
  critical: {
    bg: "#FEF2F2",
    bgDark: "#3B0000",
    text: "#991B1B",
    textDark: "#FCA5A5",
    icon: "warning-outline" as const,
  },
};

export function AlertBanner({ severity, message, onDismiss }: AlertBannerProps) {
  const { colorScheme } = useColorScheme();

  const severityConfig = {
    info: {
      ...SEVERITY_CONFIG_BASE.info,
      border: "#3B82F6",
    },
    warning: {
      ...SEVERITY_CONFIG_BASE.warning,
      border: StatusColors[colorScheme].warning,
      textDark: StatusColors[colorScheme].warning,
    },
    critical: {
      ...SEVERITY_CONFIG_BASE.critical,
      border: StatusColors[colorScheme].danger,
    },
  };

  const config = severityConfig[severity];

  return (
    <View
      className="mx-4 mb-2 px-4 py-3 rounded-xl flex-row items-start"
      style={{
        backgroundColor: config.bg,
        borderWidth: 1,
        borderColor: config.border + "40",
      }}
    >
      <Ionicons
        name={config.icon}
        size={18}
        color={config.border}
        style={{ marginTop: 1 }}
      />
      <Text
        className="flex-1 text-xs ml-2"
        style={{ color: config.text }}
      >
        {message}
      </Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} className="ml-2">
          <Ionicons name="close" size={16} color={config.border} />
        </Pressable>
      )}
    </View>
  );
}
