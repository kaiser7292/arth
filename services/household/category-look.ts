import { iconForCategoryName } from "@/constants/category-icons";
import { bestCategoryMatch, categoryMatchScore } from "./store";

export interface CategoryLook {
  icon: string;
  color: string;
}

/**
 * The icon for a shared transaction: the one on the phone of whoever added it. Older transactions
 * don't carry one until that phone has updated, and people name categories differently ("Groceries",
 * "Grocery & Supplies"), so then: my category of that name or a close one, then a fitting icon.
 */
export function categoryLook(
  author: CategoryLook | null,
  name: string | null,
  mine: (CategoryLook & { name: string })[],
): CategoryLook | null {
  if (author) return author;
  if (!name) return null;
  const close = bestCategoryMatch(name, mine);
  if (close && categoryMatchScore(name, close.name) >= 2) return close;
  return iconForCategoryName(name);
}
