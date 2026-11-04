import type { BrokerId } from "@/services/broker-terms";

/** One thing to enter on the broker's form: a value to copy, or what to do with it. */
export interface GuideField {
  label: string;
  /** Shown with a Copy button. */
  copy?: string;
  note?: string;
}

export interface GuideStep {
  text: string;
  fields?: GuideField[];
  link?: { label: string; url: string };
}

export interface GuideSection {
  title: string;
  /** A line under the title: why this part is there, or when it can be skipped. */
  intro?: string;
  steps: GuideStep[];
}

export interface BrokerGuide {
  title: string;
  sections: GuideSection[];
  /** The last words: what to check when it doesn't work. */
  ifItFails: string;
}

const READ_ONLY_NOTE = "Arth only reads. It can't place orders or move money.";

/**
 * Step-by-step setup for each broker, on its connect screen. Field names follow each broker's form
 * as far as we could confirm them; where a form may differ, a step says to fill in what it asks.
 */
export const BROKER_SETUP_GUIDES: Record<BrokerId, BrokerGuide> = {
  angel: {
    title: "How to set up Angel One",
    sections: [
      {
        title: "Create your app",
        intro: READ_ONLY_NOTE,
        steps: [
          {
            text: "Open SmartAPI, tap Login and sign in with your Angel One details.",
            link: { label: "Open SmartAPI", url: "https://smartapi.angelone.in/" },
          },
          {
            text: "Add a new app and fill in the form. If it asks for anything else, fill that in as it asks.",
            fields: [
              { label: "App Name", copy: "Arth" },
              { label: "Redirect URL", copy: "https://integration.souravbaid.com/angelone/callback", note: "Arth doesn't use this, but the form needs it." },
              { label: "Primary Static IP", note: "Your own IP address. Tap Find my IP address below and enter that number. Arth never places orders, so it's fine if your IP changes later." },
              { label: "Secondary Static IP", note: "Leave blank." },
            ],
            link: { label: "Find my IP address", url: "https://api.ipify.org" },
          },
          { text: "Save the app, then copy its API Key. You'll paste it in below." },
        ],
      },
      {
        title: "Get your TOTP secret",
        intro: "Arth uses this to make the 6-digit code itself, so you don't have to type one each time.",
        steps: [
          {
            text: "On the SmartAPI site, tap Enable TOTP.",
            link: { label: "Open SmartAPI", url: "https://smartapi.angelone.in/" },
          },
          { text: "Enter your Client ID and PIN, then the OTP sent to your email and phone." },
          { text: "A QR code appears. Copy the long text key shown with it, not a 6-digit code. If you only see the QR code, tap Can't scan?" },
          { text: "Already turned on TOTP? Use the text key you saved then. If you've lost it, ask Angel One how to reset it." },
        ],
      },
      {
        title: "Connect to Arth",
        steps: [
          { text: "Below, enter your API Key, your Client ID (the ID you log in with), your MPIN and the TOTP Secret." },
          { text: "Read the card, tick the box and tap Connect." },
          { text: "Back on the Angel One screen, tap Link a demat account, then Update snapshot with these values." },
        ],
      },
    ],
    ifItFails: "Won't connect or sync? Copy the API Key again and check for extra spaces. Most failures come from a key copied wrong.",
  },
  kite: {
    title: "How to set up Zerodha",
    sections: [
      {
        title: "Create your app",
        intro: READ_ONLY_NOTE,
        steps: [
          {
            text: "Open the Kite Connect developer site and sign up or log in. This login can be separate from your Zerodha trading login.",
            link: { label: "Open Kite Connect", url: "https://developers.kite.trade/apps" },
          },
          { text: "Choose a plan. Zerodha lists Personal as free, and it includes your holdings. Check their current pricing before you pay for anything." },
          {
            text: "Go to My Apps and tap Create New App. If the form asks for anything else, fill that in as it asks.",
            fields: [
              { label: "App Name", copy: "Arth" },
              { label: "Zerodha Client ID", note: "Your Zerodha user ID, such as AB1234." },
              { label: "Redirect URL", copy: "https://127.0.0.1", note: "Enter it exactly. Your login stays on your phone." },
              { label: "Postback URL", note: "Leave blank." },
            ],
          },
          { text: "Save the app, then copy its API Key and API Secret. You'll paste them in below." },
        ],
      },
      {
        title: "Get your TOTP key (optional)",
        intro: "Only needed if you want Arth to fill in the 6-digit code at login. Otherwise skip this and type the code yourself.",
        steps: [
          { text: "In Kite, tap your Client ID, then My profile or Settings, then Password & Security." },
          { text: "Tap Enable External TOTP and enter the OTP sent to your email." },
          { text: "Tap Can't scan? and copy the key. Save it in the TOTP key field below, and add it to your authenticator app as a time-based key." },
          { text: "To finish, enter the 6-digit code from your authenticator app and your Kite password, then tap Enable." },
          { text: "Already using TOTP? Use the key you saved when you set it up. If you don't have it, leave TOTP key blank." },
        ],
      },
      {
        title: "Connect to Arth",
        steps: [
          { text: "Below, enter your API Key and API Secret." },
          { text: "Optional: add your User ID, Password and TOTP key under Zerodha login. Arth fills them in on Zerodha's page, and you still tap Login yourself." },
          { text: "Read the card, tick the box and tap Connect. Zerodha's own login page opens, so log in there." },
          { text: "Back on the Zerodha screen, link your demat account, then tap Update snapshot with these values." },
          { text: "Zerodha asks you to log in again each day. That's Zerodha's rule, and it applies to every app that connects to Kite." },
        ],
      },
    ],
    ifItFails: "Won't connect? Copy the API Key and API Secret again and check for extra spaces, and make sure the Redirect URL is saved on your app.",
  },
  zebpay: {
    title: "How to set up ZebPay",
    sections: [
      {
        title: "Create your key",
        intro: READ_ONLY_NOTE,
        steps: [
          {
            text: "Open the ZebPay developer site and sign in with your ZebPay account.",
            link: { label: "Open ZebPay", url: "https://build.zebpay.com" },
          },
          {
            text: "Create a new API key and fill in the form. Menu names may differ, so follow what your screen shows.",
            fields: [
              { label: "Name", copy: "Arth" },
              { label: "Permissions", note: "Choose read-only permissions. Don't turn on trading or withdrawals." },
              { label: "Bind IP", note: "Leave blank. If you enter an IP, sync can stop when your phone's IP changes." },
            ],
          },
          { text: "Enter the OTP sent to your email and phone." },
          { text: "Copy the API Key and Secret Key straight away. ZebPay only shows the secret once." },
        ],
      },
      {
        title: "Connect to Arth",
        intro: "No TOTP is needed. The key is all Arth uses to connect.",
        steps: [
          { text: "Below, paste your API Key and Secret Key." },
          { text: "Read the card, tick the box and tap Connect." },
          { text: "Back on the ZebPay screen, tap Sync, then Link an account, then Update snapshot with these values." },
        ],
      },
    ],
    ifItFails: "Won't connect? Copy both keys again and check for extra spaces, and check the key has read permission and no IP bound to it.",
  },
};
