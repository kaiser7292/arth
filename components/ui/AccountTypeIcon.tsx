import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { tint } from "@/constants/brand";
import { useTheme, type Theme } from "@/hooks/use-theme";

/**
 * Account-type icons exactly as drawn on the design boards ("Account settings" type list,
 * "Accounts", "Investments"): 24×24 stroke paths, 2px, round caps. Ionicons has no bank-with-
 * pillars, rupee-style deposit mark or these exact shapes, so they are drawn here.
 */
const PATHS: Record<string, string> = {
  savings: "M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18",
  credit_card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20",
  wallet: "M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01",
  fd: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  demat: "M3 17l6-6 4 4 8-8M15 7h6v6",
  loan: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  pension: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
};

/** "bank" and "investment" are other names for these in the data. */
function key(type: string | null | undefined): string {
  if (type === "bank") return "savings";
  if (type === "investment") return "fd";
  return type && PATHS[type] ? type : "savings";
}

/** Each type's colour, as on the boards, from the app's tokens. */
export function accountTypeColor(theme: Theme, type: string | null | undefined): string {
  switch (key(type)) {
    case "credit_card":
      return theme.data.accountType.credit_card;
    case "wallet":
    case "demat":
      return theme.data.series[2];
    case "loan":
      return theme.data.accountType.loan;
    case "pension":
      return theme.data.series[3];
    default:
      return theme.data.accountType.savings;
  }
}

export function AccountTypeIcon({ type, size = 18, color }: { type: string | null | undefined; size?: number; color?: string }) {
  const theme = useTheme();
  const c = color ?? accountTypeColor(theme, type);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={PATHS[key(type)]} />
    </Svg>
  );
}

/** The icon on its tinted square, as in the boards' rows. */
export function AccountTypeTile({ type, size = 36, radius = 11, dim = false }: { type: string | null | undefined; size?: number; radius?: number; dim?: boolean }) {
  const theme = useTheme();
  const c = accountTypeColor(theme, type);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, alignItems: "center", justifyContent: "center", backgroundColor: tint(c, dim ? 0.06 : 0.1) }}>
      <AccountTypeIcon type={type} size={Math.round(size * 0.48)} color={dim ? theme.mutedForeground : c} />
    </View>
  );
}
