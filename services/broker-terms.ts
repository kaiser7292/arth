/**
 * Bring-your-own-key (BYOK) terms for broker connections.
 *
 * Each broker connection uses the user's own API credentials, so the user
 * agrees once per broker to follow that broker's terms before connecting.
 * Links were checked live on 2026-09-26.
 */
import { settingsStorage } from "@/services/storage";

export type BrokerId = "kite" | "angel" | "zebpay";

export interface BrokerTerms {
  id: BrokerId;
  name: string;
  /** Where the user creates / deletes their API key. */
  consoleLabel: string;
  links: Array<{ label: string; url: string }>;
  /** Broker-specific sentence for "Where your credentials go". */
  credentialsNote: string;
  /** Extra warning shown under the card, if any. */
  warning?: string;
}

export const BROKER_TERMS: Record<BrokerId, BrokerTerms> = {
  kite: {
    id: "kite",
    name: "Zerodha",
    consoleLabel: "Kite Connect developer console",
    links: [
      { label: "Kite Connect terms", url: "https://kite.trade/terms/" },
      { label: "Zerodha privacy policy", url: "https://zerodha.com/privacy-policy/" },
      { label: "Developer console", url: "https://developers.kite.trade/apps" },
    ],
    credentialsNote:
      "Your API key is stored encrypted on this phone and sent only to Zerodha. You sign in on Zerodha's own page; the one-time login code passes through Arth's connection server, which doesn't keep it.",
  },
  angel: {
    id: "angel",
    name: "Angel One",
    consoleLabel: "SmartAPI dashboard",
    links: [
      { label: "SmartAPI", url: "https://smartapi.angelone.in/" },
      { label: "Terms & conditions", url: "https://www.angelone.in/disclaimer" },
      { label: "Privacy policy", url: "https://www.angelone.in/privacy-policy" },
    ],
    credentialsNote: "Your credentials are stored encrypted on this phone and sent only to Angel One.",
    warning:
      "Your PIN and 2FA (TOTP) secret are stored encrypted on this phone so Arth can refresh your session. Anyone who can unlock your phone and Arth could use them. Keep Arth's app lock on.",
  },
  zebpay: {
    id: "zebpay",
    name: "Zebpay",
    consoleLabel: "Zebpay developer portal",
    links: [
      { label: "Developer portal", url: "https://build.zebpay.com" },
      { label: "Legal & privacy", url: "https://zebpay.com/in/legal-privacy" },
    ],
    credentialsNote: "Your API key and secret are stored encrypted on this phone and sent only to Zebpay.",
  },
};

const ACCEPTED_KEYS: Record<BrokerId, string> = {
  kite: "broker_terms_accepted_kite",
  angel: "broker_terms_accepted_angel",
  zebpay: "broker_terms_accepted_zebpay",
};

export function hasAcceptedBrokerTerms(id: BrokerId): boolean {
  return !!settingsStorage.getString(ACCEPTED_KEYS[id]);
}

export function acceptBrokerTerms(id: BrokerId): void {
  settingsStorage.set(ACCEPTED_KEYS[id], new Date().toISOString());
}
