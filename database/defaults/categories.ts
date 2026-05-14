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
