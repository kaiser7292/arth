/**
 * The contract between Arth and the user's AI assistant: what the user can ask for, and the exact
 * shape the assistant must reply in. The export (services/ai-export.ts) writes these instructions
 * into the file; the importer (services/ai-suggestions.ts) reads replies written to them.
 *
 * The instructions are deliberately rigid. The reply is read by a machine, pasted by a person
 * from a chat app, so anything loose here turns into a failed import there.
 */

export type AiRequestId = "everything" | "setup" | "tidy" | "budget" | "missing" | "messages";

export interface AiRequest {
  id: AiRequestId;
  /** Label on the AI Assisted Setup screen. */
  label: string;
  /** What the user is asking the assistant to do. Written into the file and sent with it. */
  prompt: string;
}

const FULL_SETUP =
  "add any categories I need, give every merchant a category, suggest monthly budgets, work out the format of each unread transaction message, and set up my income, savings target, investment buckets and goals. Don't ask me anything first: reply with the whole setup straight away.";

export const AI_REQUESTS: AiRequest[] = [
  { id: "everything", label: "Set up everything", prompt: `Set Arth up properly for me, end to end: ${FULL_SETUP}` },
  { id: "setup", label: "Set up everything", prompt: `I have just started using Arth. Set it up for me: ${FULL_SETUP}` },
  {
    id: "tidy",
    label: "Tidy my categories",
    prompt:
      "Go through my transactions. Give every merchant its right category, merge merchant names that are spelled several ways, and re-categorise the single entries that are exceptions.",
  },
  {
    id: "budget",
    label: "Suggest a budget",
    prompt: "Suggest a monthly budget for each category I spend in, based on my actual spending in this file.",
  },
  {
    id: "missing",
    label: "Find what's missing",
    prompt:
      "Find regular payments (rent, subscriptions, bills, EMIs) that appear most months but are missing from a recent month, and suggest them as transactions.",
  },
  {
    id: "messages",
    label: "Read my unread transaction messages",
    prompt: "Work out the format of each unread transaction message in this file so Arth can read messages like it.",
  },
];

/** Requests that set up income, savings target, buckets and goals as well as the day-to-day side. */
export function isFullSetup(id: AiRequestId | undefined): boolean {
  return id === "everything" || id === "setup";
}

/** The text sent alongside the file (and copied to the clipboard as a fallback). */
export function aiShareMessage(request: AiRequest): string {
  return `${request.prompt} The attached Arth file explains its contents and the exact reply format - follow it.`;
}

/** Short, stable reference for a row: a letter plus the first 8 hex characters of its id. */
export function shortRef(prefix: "t" | "s", id: string): string {
  return prefix + id.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).toLowerCase();
}

export const MAX_SUGGESTIONS = 500;

/** Field names an SMS template suggestion may label. Mirrors TaggedField in template-compiler.ts. */
export const SMS_TEMPLATE_FIELDS = [
  "amount", "account", "merchant", "date", "balance", "ref", "counterparty", "other_account",
] as const;

/** Rule conditions the assistant may use. No regular expressions. */
export const RULE_FIELDS = ["merchant", "description", "amount"] as const;
export const RULE_OPERATORS = [
  "contains", "equals", "starts_with", "ends_with", "greater_than", "less_than",
] as const;

/**
 * The "how to reply" section of the export file, one instruction per line. Examples are written
 * out as text (not nested JSON) so the file's own structure stays small and fixed.
 */
export function buildReplyInstructions(has: {
  unreadMessages: boolean;
  unreviewed: boolean;
  /** Income, savings target, buckets and goals are asked for too. */
  fullSetup: boolean;
}): string[] {
  const lines: string[] = [];
  if (has.fullSetup) {
    lines.push(
      "DO NOT ASK QUESTIONS. Reply straight away with every suggestion in the format below, in this one message: the user is in the middle of setting up and wants it done in one go. Work everything out from `current_setup` and the data. Income: keep what `current_setup` has; if there is none, use the regular credit you can see (its usual amount and day). Bonus, savings target, regular investments and goals: suggest them only when `current_setup` or the data clearly shows them (for example a yearly credit that looks like a bonus, or monthly SIP debits); otherwise leave those suggestion types out, as the user can add them in Arth later. Never invent goals. Do everything else (categories, merchants, budgets, transaction messages) in full.",
    );
  }
  lines.push(
    "HOW TO REPLY. Arth reads your reply by machine. Follow this exactly.",
    "Reply with ONE fenced json code block. You may write one short sentence before it. Write nothing after it, and no notes or comments inside it.",
    'The block holds one JSON object: {"arth_suggestions":1,"suggestions":[ ... ]}. Put one suggestion object per line. Use straight double quotes, no trailing commas, numbers without quotes or thousands separators.',
    "Use only the suggestion types below, with exactly these field names. Every suggestion has a `why`: one plain sentence of at most 12 words for the user. Anything else in the block is thrown away.",
    'add_category - a category that does not exist yet: {"type":"add_category","name":"Pets","why":"9 vet and pet-shop entries sit under Other"}',
    'merchant_category - file a merchant under a category, for past and future entries. `merchant` is a lowercase word or phrase found in that merchant\'s name: {"type":"merchant_category","merchant":"swiggy","category":"Food","why":"41 food delivery orders"}',
    'recategorise - one single transaction, when it is an exception to its merchant\'s category. Copy `ref`, `date` and `amount` exactly from the transaction: {"type":"recategorise","ref":"t1a2b3c4","date":"2026-09-14","amount":482,"category":"Gifts","why":"Birthday order, not groceries"}',
    'add_rule - only for a pattern a merchant_category cannot express, such as an amount limit. `when` conditions must all hold. Fields: merchant, description, amount. Tests: contains, equals, starts_with, ends_with, greater_than, less_than: {"type":"add_rule","name":"Big Amazon orders","when":[{"field":"merchant","is":"contains","value":"amazon"},{"field":"amount","is":"greater_than","value":10000}],"category":"Electronics","why":"Large Amazon orders are gadgets"}',
    'fix_merchant - one merchant written several ways. One suggestion per wrong spelling, `from` copied exactly: {"type":"fix_merchant","from":"AMZN MKTP IN","to":"Amazon","why":"Same shop as Amazon"}',
    'set_budget - a monthly budget for a category: {"type":"set_budget","category":"Groceries","amount":12000,"why":"Average of the last 4 months is 11300"}',
    'add_transaction - a payment that is clearly missing. `kind` is spend or income. `account` is an account `name` from this file, or null: {"type":"add_transaction","date":"2026-09-05","amount":15000,"kind":"spend","category":"Rent","merchant":"Landlord","account":"HDFC","why":"Paid every month, missing in September"}',
  );
  if (has.unreadMessages) {
    lines.push(
      'sms_template - the format of one message in `unread_messages`. `sms` is that message\'s `id`. `kind` is debit, credit or refund. In `fields`, give each part you can find, copied character for character from the message `text` (no added symbols): amount, account (the digits shown), merchant, date, balance, ref, counterparty (the other person\'s name), other_account. `amount` is required. Skip messages that are not about a real transaction (offers, OTPs, reminders): {"type":"sms_template","sms":"s9f8e7d6","bank":"Kotak","kind":"debit","fields":{"amount":"482.00","account":"4521","merchant":"SWIGGY","date":"14-09-26","balance":"38,214.10","ref":"426718890123"},"why":"Kotak UPI debit alert"}',
    );
  }
  if (has.fullSetup) {
    lines.push(
      'set_income - the user\'s take-home pay for the current financial year. `monthly` is the usual amount after tax. `pay_day` is the day of the month it arrives (1 to 31). `bonus` is the bonus expected this financial year, 0 if none. Use `months` only when income varies: give the months that differ from `monthly`, as YYYY-MM inside the current financial year; otherwise leave it empty: {"type":"set_income","monthly":142500,"pay_day":1,"bonus":50000,"months":{"2026-09":146700},"why":"Salary credit of 142500 on the 1st each month"}',
      'set_savings_target - the share of income the user wants to save, as a percentage: {"type":"set_savings_target","percent":30,"why":"You said you want to save 30 percent"}',
      'add_investment_bucket - something the user puts money into regularly, with the amount for the whole financial year: {"type":"add_investment_bucket","name":"Mutual funds","annual_target":120000,"why":"You invest 10000 a month in mutual funds"}',
      'add_milestone - something the user is saving for, with the amount needed and the date: {"type":"add_milestone","name":"House down payment","target_amount":1500000,"target_date":"2029-03-31","why":"You want 15 lakh by March 2029"}',
      "set_income, set_savings_target, add_investment_bucket and add_milestone must come from `current_setup` or from clear evidence in this file (a regular salary credit, monthly SIP debits, a yearly bonus). Never choose a savings target, an investment or a goal for the user, and do not recommend what to invest in. If the file does not show it, leave it out.",
    );
  }
  lines.push(
    "ORDER OF WORK. First decide the categories. Then give each merchant its category with merchant_category - this is the main tool, one suggestion covers every entry of that merchant. Use recategorise only for single exceptions and add_rule only when a merchant needs different categories depending on a condition. Never use recategorise or add_rule for something a merchant_category already covers.",
    "RULES. Category names must match `categories` in this file exactly, or be added by an add_category earlier in the same reply. Do not invent transactions, references or merchants: every `ref`, `sms`, merchant and `from` must come from this file. Do not suggest what is already true (a merchant already in that category, a budget already at that amount).",
    `At most ${MAX_SUGGESTIONS} suggestions. If you find nothing to suggest, reply with {"arth_suggestions":1,"suggestions":[]}.`,
  );
  if (has.unreviewed) {
    lines.push(
      "Transactions with `reviewed` false were read from transaction messages and are still waiting for the user to check them. Treat them as real when choosing merchant categories. `monthly_summary` and `budgets` count reviewed entries only, so work out budgets from `merchants` and `transactions` instead.",
    );
  }
  return lines;
}
