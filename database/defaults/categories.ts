export interface DefaultCategory {
  name: string;
  icon: string;
  color: string;
  is_unavoidable: 0 | 1;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Car & Vehicles", icon: "car-outline", color: "#3B82F6", is_unavoidable: 1 },
  { name: "Health & Medicine", icon: "medkit-outline", color: "#EF4444", is_unavoidable: 1 },
  { name: "Travel & Going Out", icon: "airplane-outline", color: "#8B5CF6", is_unavoidable: 0 },
  { name: "Rent & Utilities", icon: "home-outline", color: "#F59E0B", is_unavoidable: 1 },
  { name: "Subscriptions", icon: "tv-outline", color: "#EC4899", is_unavoidable: 0 },
  { name: "Grocery & Supplies", icon: "cart-outline", color: "#10B981", is_unavoidable: 1 },
  { name: "Food", icon: "restaurant-outline", color: "#F97316", is_unavoidable: 0 },
  { name: "Shopping & Gifts", icon: "gift-outline", color: "#6366F1", is_unavoidable: 0 },
  { name: "Family", icon: "heart-outline", color: "#E11D48", is_unavoidable: 0 },
  { name: "Miscellaneous", icon: "ellipsis-horizontal-circle-outline", color: "#6B7280", is_unavoidable: 0 },
  { name: "Insurance", icon: "shield-checkmark-outline", color: "#14B8A6", is_unavoidable: 1 },
  { name: "EMIs", icon: "card-outline", color: "#0EA5E9", is_unavoidable: 1 },
  { name: "Unknown", icon: "help-circle-outline", color: "#9CA3AF", is_unavoidable: 0 },
];

/**
 * Sub-categories (migration 095) under each default category. A new install gets these; an
 * existing one is offered them in Settings › Categories › Organise (services/category-organise.ts),
 * and nothing moves until the owner says so.
 *
 * The top-level names above are unchanged on purpose: merchant rules and the smart categoriser
 * file transactions by category NAME, so renaming one would strand its rules. Sub-categories take
 * their parent's icon, colour and unavoidable flag, and their spending counts toward the parent's
 * budget.
 */
export const DEFAULT_SUBCATEGORIES: Record<string, string[]> = {
  "Car & Vehicles": ["Fuel", "Service & repairs", "Parking & tolls", "Cab & auto"],
  "Health & Medicine": ["Doctor", "Medicines", "Tests & scans", "Fitness"],
  "Travel & Going Out": ["Flights & trains", "Hotels & stays", "Movies & events"],
  "Rent & Utilities": ["Rent", "Electricity", "Mobile & internet", "Gas & water", "Maintenance"],
  Subscriptions: ["Streaming", "Apps & software", "Memberships"],
  "Grocery & Supplies": ["Groceries", "Household supplies", "Personal care"],
  Food: ["Eating out", "Food delivery", "Snacks & coffee"],
  "Shopping & Gifts": ["Clothes", "Electronics", "Home & furniture", "Gifts"],
  Family: ["Kids & school", "Parents", "Pets"],
  Insurance: ["Health insurance", "Life insurance", "Vehicle insurance"],
  EMIs: ["Home loan", "Vehicle loan", "Personal loan", "Credit card EMI"],
};

/**
 * Other names people give a category that is really one of the sub-categories above, so an
 * existing top-level "Petrol" or "Dining" can be offered a place under its parent.
 */
export const SUBCATEGORY_ALIASES: Record<string, { parent: string; sub: string }> = {
  petrol: { parent: "Car & Vehicles", sub: "Fuel" },
  diesel: { parent: "Car & Vehicles", sub: "Fuel" },
  cab: { parent: "Car & Vehicles", sub: "Cab & auto" },
  taxi: { parent: "Car & Vehicles", sub: "Cab & auto" },
  uber: { parent: "Car & Vehicles", sub: "Cab & auto" },
  medicine: { parent: "Health & Medicine", sub: "Medicines" },
  pharmacy: { parent: "Health & Medicine", sub: "Medicines" },
  gym: { parent: "Health & Medicine", sub: "Fitness" },
  movies: { parent: "Travel & Going Out", sub: "Movies & events" },
  internet: { parent: "Rent & Utilities", sub: "Mobile & internet" },
  broadband: { parent: "Rent & Utilities", sub: "Mobile & internet" },
  mobile: { parent: "Rent & Utilities", sub: "Mobile & internet" },
  "mobile recharge": { parent: "Rent & Utilities", sub: "Mobile & internet" },
  ott: { parent: "Subscriptions", sub: "Streaming" },
  grocery: { parent: "Grocery & Supplies", sub: "Groceries" },
  dining: { parent: "Food", sub: "Eating out" },
  restaurants: { parent: "Food", sub: "Eating out" },
  "dining out": { parent: "Food", sub: "Eating out" },
  swiggy: { parent: "Food", sub: "Food delivery" },
  zomato: { parent: "Food", sub: "Food delivery" },
  coffee: { parent: "Food", sub: "Snacks & coffee" },
  clothing: { parent: "Shopping & Gifts", sub: "Clothes" },
  apparel: { parent: "Shopping & Gifts", sub: "Clothes" },
  gadgets: { parent: "Shopping & Gifts", sub: "Electronics" },
  school: { parent: "Family", sub: "Kids & school" },
  education: { parent: "Family", sub: "Kids & school" },
  "home loan emi": { parent: "EMIs", sub: "Home loan" },
  "car loan": { parent: "EMIs", sub: "Vehicle loan" },
};
