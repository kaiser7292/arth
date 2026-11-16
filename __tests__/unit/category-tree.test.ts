import { buildCategoryTree, categoryPath, parentProblem, rollupCategoryId } from "../../utils/category-tree";

const cats = [
  { id: "food", name: "Food", parent_id: null },
  { id: "groc", name: "Groceries", parent_id: "food" },
  { id: "bills", name: "Bills", parent_id: null },
  { id: "eat", name: "Eating out", parent_id: "food" },
  { id: "orphan", name: "Orphan", parent_id: "gone" },
];
const byId = new Map(cats.map((c) => [c.id, c]));

describe("category tree (sub-categories, migration 095)", () => {
  it("groups each sub-category under its parent, keeping order", () => {
    const tree = buildCategoryTree(cats);
    expect(tree.map((g) => g.parent.id)).toEqual(["food", "bills", "orphan"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["groc", "eat"]);
  });

  it("names a sub-category with its parent", () => {
    expect(categoryPath(byId.get("groc")!, byId)).toBe("Food › Groceries");
    expect(categoryPath(byId.get("bills")!, byId)).toBe("Bills");
    expect(categoryPath(byId.get("orphan")!, byId)).toBe("Orphan");
  });

  it("rolls a sub-category up to its parent for budgets", () => {
    expect(rollupCategoryId(byId.get("groc")!, byId)).toBe("food");
    expect(rollupCategoryId(byId.get("bills")!, byId)).toBe("bills");
  });

  it("allows one level only", () => {
    expect(parentProblem("bills", "food", cats)).toBeNull();
    expect(parentProblem("bills", null, cats)).toBeNull();
    expect(parentProblem("bills", "groc", cats)).toMatch(/can't have sub-categories/);
    expect(parentProblem("food", "bills", cats)).toMatch(/has sub-categories/);
    expect(parentProblem("food", "food", cats)).toMatch(/itself/);
  });
});
