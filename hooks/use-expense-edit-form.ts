import { useState, type Dispatch, type SetStateAction } from "react";
import type { ExpenseValidationErrors } from "@/utils/expense-validation";

/**
 * The editable fields on expense detail, and the dropdown open/closed flags that go with them.
 *
 * These were fifteen separate useState calls in app/expense/[id].tsx. Gathering them here is what
 * makes the edit form extractable at all: a component cannot reasonably take fifteen value/setter
 * pairs as props, but it can take one object.
 *
 * The screen destructures everything it returns, so the ~250 existing references to `amount`,
 * `date` and the rest keep working untouched. That was deliberate - renaming them all to
 * `form.amount` needs scope-aware tooling, because a plain search also matches `expense.amount`
 * and would corrupt every property access it touched.
 */
export interface ExpenseEditForm {
  amount: string;
  setAmount: Dispatch<SetStateAction<string>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  categoryId: string | null;
  setCategoryId: Dispatch<SetStateAction<string | null>>;
  paymentModeId: string | null;
  setPaymentModeId: Dispatch<SetStateAction<string | null>>;
  date: string;
  setDate: Dispatch<SetStateAction<string>>;
  merchantName: string;
  setMerchantName: Dispatch<SetStateAction<string>>;
  isRightSpend: boolean;
  setIsRightSpend: Dispatch<SetStateAction<boolean>>;
  accountId: string | null;
  setAccountId: Dispatch<SetStateAction<string | null>>;
  errors: ExpenseValidationErrors;
  setErrors: Dispatch<SetStateAction<ExpenseValidationErrors>>;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;

  /** Which picker is currently expanded. At most one is open in practice. */
  showAccounts: boolean;
  setShowAccounts: Dispatch<SetStateAction<boolean>>;
  showCategories: boolean;
  setShowCategories: Dispatch<SetStateAction<boolean>>;
  showPaymentModes: boolean;
  setShowPaymentModes: Dispatch<SetStateAction<boolean>>;
  showMerchants: boolean;
  setShowMerchants: Dispatch<SetStateAction<boolean>>;
  showDatePicker: boolean;
  setShowDatePicker: Dispatch<SetStateAction<boolean>>;
}

export function useExpenseEditForm(): ExpenseEditForm {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentModeId, setPaymentModeId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [isRightSpend, setIsRightSpend] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ExpenseValidationErrors>({});
  const [saving, setSaving] = useState(false);

  const [showAccounts, setShowAccounts] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showPaymentModes, setShowPaymentModes] = useState(false);
  const [showMerchants, setShowMerchants] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  return {
    amount, setAmount,
    description, setDescription,
    categoryId, setCategoryId,
    paymentModeId, setPaymentModeId,
    date, setDate,
    merchantName, setMerchantName,
    isRightSpend, setIsRightSpend,
    accountId, setAccountId,
    errors, setErrors,
    saving, setSaving,
    showAccounts, setShowAccounts,
    showCategories, setShowCategories,
    showPaymentModes, setShowPaymentModes,
    showMerchants, setShowMerchants,
    showDatePicker, setShowDatePicker,
  };
}
