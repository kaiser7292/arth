import { MONEY, DATA, type MoneyToneName } from "@/constants/design-tokens";
import { withAlpha, toHex } from "@/constants/brand";
import type { Theme } from "@/hooks/use-theme";

export type { MoneyToneName };

/** Text and fill colour for an amount, by which way the money went. See MONEY in design-tokens.js. */
export function moneyTone(theme: Theme, tone: MoneyToneName): { fg: string; bg: string } {
  const t = MONEY[tone];
  const channels = (role: typeof t.fg) => (role === "transfer" ? DATA.transfer : theme.channels[role]);
  return {
    fg: t.fg === "transfer" ? toHex(DATA.transfer) : theme[t.fg],
    bg: withAlpha(channels(t.fill), t.fillAlpha),
  };
}

/** The tone for a transaction, from its nature and whether it moved between own accounts. */
export function toneForTransaction(opts: { nature?: string | null; isTransfer?: boolean; isCredit?: boolean }): MoneyToneName {
  if (opts.isTransfer) return "moved";
  if (opts.isCredit || opts.nature === "credit") return "in";
  return "out";
}
