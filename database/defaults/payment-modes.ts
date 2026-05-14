export interface DefaultPaymentMode {
  name: string;
  type: "credit_card" | "debit_card" | "upi" | "cash" | "wallet" | "bank_transfer";
}

export const DEFAULT_PAYMENT_MODES: DefaultPaymentMode[] = [
  { name: "UPI", type: "upi" },
  { name: "Credit Card", type: "credit_card" },
  { name: "Debit Card", type: "debit_card" },
  { name: "Net Banking", type: "bank_transfer" },
  { name: "Cash", type: "cash" },
  { name: "Wallet", type: "wallet" },
];
