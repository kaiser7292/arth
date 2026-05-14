import { Ionicons } from "@expo/vector-icons";
import type { PaymentModeType } from "@/services/payment-mode";

/** Icon mapping for payment mode types */
export const TYPE_ICONS: Record<PaymentModeType, keyof typeof Ionicons.glyphMap> = {
  credit_card: "card-outline",
  debit_card: "card-outline",
  upi: "phone-portrait-outline",
  cash: "cash-outline",
  wallet: "wallet-outline",
  bank_transfer: "business-outline",
};
