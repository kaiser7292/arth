import { useCallback, useState } from "react";
import { CategoryPickerSheet } from "@/components/expense/catch-up/CategoryPickerSheet";
import { useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bulkSetCategory, bulkUpdateExpenses } from "@/services/expense-bulk";
import { getCategories, type Category } from "@/services/category";
import type { Expense } from "@/services/expense";

/**
 * "+ Add category" on an untagged transaction row: pick one in place, no trip to the detail page.
 * Saves on tap and offers Undo. Every list that shows ExpenseListRow uses this, so the chip behaves
 * the same everywhere.
 *
 *   const addCategory = useAddCategory({ categories, onSaved: reload });
 *   <ExpenseListRow onAddCategory={addCategory.open} … />
 *   {addCategory.sheet}
 */
export function useAddCategory({
  categories,
  onSaved,
  allowCreate = true,
}: {
  categories: Category[];
  /** Reload the list. The write also bumps the data version, so focused screens refresh anyway. */
  onSaved?: () => void;
  /** Offer "+ New" to add a sub-category from the picker. */
  allowCreate?: boolean;
}) {
  const toast = useToast();
  const [target, setTarget] = useState<Expense | null>(null);
  // A sub-category made in the picker isn't in the caller's list yet.
  const [extra, setExtra] = useState<Category[]>([]);

  const pick = useCallback(
    async (categoryId: string) => {
      const expense = target;
      setTarget(null);
      if (!expense) return;
      const before = expense.category_id;
      await bulkSetCategory([expense.id], categoryId);
      let name = [...categories, ...extra].find((c) => c.id === categoryId)?.name;
      if (!name) {
        const fresh = await getCategories(DEFAULT_USER_ID).catch(() => [] as Category[]);
        setExtra(fresh.filter((c) => !categories.some((k) => k.id === c.id)));
        name = fresh.find((c) => c.id === categoryId)?.name;
      }
      onSaved?.();
      toast(name ? `Added to ${name}` : "Category added", {
        actionLabel: "Undo",
        onAction: async () => {
          await bulkUpdateExpenses([expense.id], { category_id: before ?? null });
          onSaved?.();
        },
      });
    },
    [target, categories, extra, onSaved, toast],
  );

  const sheet = (
    <CategoryPickerSheet
      visible={target != null}
      categories={[...categories, ...extra]}
      selectedId={null}
      onSelect={pick}
      onClose={() => setTarget(null)}
      merchantName={target?.merchant_name}
      allowCreate={allowCreate}
    />
  );

  return { open: setTarget as (e: Expense) => void, sheet };
}
