import { tint } from "@/constants/brand";
import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable, TextInput, FlatList, Switch, useWindowDimensions, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Input, ScreenContainer, SelectSheet, Sheet, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  getCategoryById,
  getCategories,
  createCategory,
  updateCategory,
  setCategoryParent,
  type Category,
} from "@/services/category";
import { useTheme } from "@/hooks/use-theme";

const ICON_OPTIONS = [
  // Transport & Travel
  "car-outline",
  "bus-outline",
  "train-outline",
  "bicycle-outline",
  "airplane-outline",
  "boat-outline",
  "subway-outline",
  // Home & Living
  "home-outline",
  "bed-outline",
  "water-outline",
  "flash-outline",
  "wifi-outline",
  "construct-outline",
  // Food & Grocery
  "restaurant-outline",
  "fast-food-outline",
  "cafe-outline",
  "beer-outline",
  "wine-outline",
  "pizza-outline",
  "cart-outline",
  "nutrition-outline",
  // Health & Fitness
  "medkit-outline",
  "fitness-outline",
  "heart-outline",
  "pulse-outline",
  "bandage-outline",
  "body-outline",
  // Entertainment & Leisure
  "tv-outline",
  "film-outline",
  "musical-notes-outline",
  "game-controller-outline",
  "headset-outline",
  "ticket-outline",
  "camera-outline",
  "book-outline",
  // Shopping & Gifts
  "gift-outline",
  "bag-handle-outline",
  "shirt-outline",
  "glasses-outline",
  "diamond-outline",
  "pricetag-outline",
  // Finance & Business
  "card-outline",
  "cash-outline",
  "wallet-outline",
  "receipt-outline",
  "trending-up-outline",
  "shield-checkmark-outline",
  "briefcase-outline",
  "calculator-outline",
  // Education & Family
  "school-outline",
  "library-outline",
  "people-outline",
  "person-outline",
  "happy-outline",
  "balloon-outline",
  // Pets & Nature
  "paw-outline",
  "leaf-outline",
  "flower-outline",
  "earth-outline",
  // Tech & Communication
  "phone-portrait-outline",
  "laptop-outline",
  "desktop-outline",
  "cloud-outline",
  "mail-outline",
  "chatbubble-outline",
  // Other
  "cut-outline",
  "color-palette-outline",
  "rocket-outline",
  "star-outline",
  "flag-outline",
  "location-outline",
  "time-outline",
  "calendar-outline",
  "bulb-outline",
  "hammer-outline",
  "key-outline",
  "help-circle-outline",
  "ellipsis-horizontal-circle-outline",
];

const COLOR_OPTIONS = [
  // Blues
  "#3B82F6",
  "#2563EB",
  "#0EA5E9",
  "#06B6D4",
  // Greens
  "#10B981",
  "#16A34A",
  "#84CC16",
  "#14B8A6",
  // Warm
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#EF4444",
  // Cool
  "#DC2626",
  "#EC4899",
  "#F43F5E",
  "#8B5CF6",
  // Purple & Indigo
  "#6366F1",
  "#A855F7",
  "#7C3AED",
  "#D946EF",
  // Neutral
  "#6B7280",
  "#78716C",
  "#64748B",
  "#334155",
];


interface PickerDrawerProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function PickerDrawer({ visible, onClose, title, children }: PickerDrawerProps) {
  const theme = useTheme();
  // Both pickers render a scrollable (an icon grid, a colour list), which needs a definite
  // height to scroll against - inside Sheet's auto-height panel a flex-1 child collapses to
  // nothing. Read live rather than at module scope so it survives a rotation.
  const drawerHeight = useWindowDimensions().height * 0.55;

  return (
    <Sheet visible={visible} onClose={onClose}>
          <View className="flex-row items-center justify-between px-4 pb-2">
            <Text className="text-body font-semibold text-foreground">
              {title}
            </Text>
            <Pressable onPress={onClose} className="p-1">
              <Ionicons name="close" size={22} color={theme.mutedForeground} />
            </Pressable>
          </View>
          {/* Content */}
          <View style={{ height: drawerHeight }} className="px-4 pb-4">
            {children}
          </View>
    </Sheet>
  );
}

export default function CategoryEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const alert = useAlert();
  const { colorScheme } = useColorScheme();
  const theme = useTheme();
  const { id, parentId: parentParam } = useLocalSearchParams<{ id?: string; parentId?: string }>();
  const isEditing = !!id;
  const scrollRef = useRef<ScrollView>(null);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ellipsis-horizontal-circle-outline");
  const [color, setColor] = useState("#6B7280");
  const [isUnavoidable, setIsUnavoidable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCustomColor, setShowCustomColor] = useState(false);
  const [customHex, setCustomHex] = useState("");
  const [showIconDrawer, setShowIconDrawer] = useState(false);
  const [showColorDrawer, setShowColorDrawer] = useState(false);
  // Sub-categories (095): which top-level category this sits under, if any.
  const [parentId, setParentId] = useState<string | null>(parentParam ?? null);
  const [originalParentId, setOriginalParentId] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [showParentSheet, setShowParentSheet] = useState(false);
  const styleTouched = useRef(false);

  useEffect(() => {
    getCategories(DEFAULT_USER_ID).then(setAllCategories).catch(() => {});
  }, []);
  // A category with sub-categories of its own can't become one (one level only).
  const hasChildren = !!id && allCategories.some((c) => c.parent_id === id);
  const parentOptions = allCategories.filter((c) => !c.parent_id && c.id !== id);
  const parentName = parentId ? allCategories.find((c) => c.id === parentId)?.name ?? null : null;
  // A new sub-category starts with its parent's look.
  useEffect(() => {
    if (isEditing || styleTouched.current || !parentId) return;
    const p = allCategories.find((c) => c.id === parentId);
    if (p) {
      setIcon(p.icon);
      setColor(p.color);
      setIsUnavoidable(p.is_unavoidable === 1);
    }
  }, [parentId, allCategories, isEditing]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (id) {
      getCategoryById(id).then((cat) => {
        if (cat) {
          setName(cat.name);
          setIcon(cat.icon);
          setColor(cat.color);
          setIsUnavoidable(cat.is_unavoidable === 1);
          setParentId(cat.parent_id ?? null);
          setOriginalParentId(cat.parent_id ?? null);
        }
      });
    }
  }, [id]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Error", "Category name is required.");
      return;
    }
    // Merchant rules file transactions by category name, so two categories can't share one.
    const clash = allCategories.find((c) => c.id !== id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (clash) {
      alert("Name already used", `"${clash.name}" is already a category. Pick another name.`);
      return;
    }

    setLoading(true);
    try {
      if (isEditing && id) {
        await updateCategory(id, {
          name: name.trim(),
          icon,
          color,
          is_unavoidable: isUnavoidable ? 1 : 0,
        });
        if (parentId !== originalParentId) await setCategoryParent(id, parentId);
      } else {
        await createCategory({
          user_id: DEFAULT_USER_ID,
          name: name.trim(),
          icon,
          color,
          is_unavoidable: isUnavoidable ? 1 : 0,
          parent_id: parentId,
        });
      }
      router.back();
    } catch (e) {
      logger.error("Save category failed:", e);
      alert("Error", formatError("Save category", e));
    } finally {
      setLoading(false);
    }
  };

  const renderIconItem = useCallback(({ item: iconName }: { item: string }) => (
    <Pressable
      onPress={() => { styleTouched.current = true; setIcon(iconName); setShowIconDrawer(false); }}
      className={`w-12 h-12 rounded-control items-center justify-center m-1 ${
        icon === iconName
          ? "border-2"
          : "bg-card"
      }`}
      style={icon === iconName ? {
        backgroundColor: theme.alpha("primary", 0.1),
        borderColor: theme.primary,
      } : undefined}
    >
      <Ionicons
        name={iconName as keyof typeof Ionicons.glyphMap}
        size={22}
        color={icon === iconName ? theme.primary : "#6B7280"}
      />
    </Pressable>
  ), [icon, colorScheme, theme.primary]);

  // Board "Category editor": twelve icons and eight colours right here, the current one always
  // among them; "All icons" and "More colours" open the full pickers.
  const quickIcons = [icon, ...ICON_OPTIONS.filter((i) => i !== icon)].slice(0, 12);
  const quickColors = [color, ...COLOR_OPTIONS.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 8);
  const previewName = name.trim() || "New category";

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {/* How it looks in lists */}
        <View className="items-center px-4 pt-2 pb-4" style={{ gap: 8 }}>
          <View className="items-center justify-center" style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: tint(color, 0.12) }}>
            <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={30} color={color} />
          </View>
          <View className="rounded-pill px-3 justify-center" style={{ height: 32, backgroundColor: tint(color, 0.12) }}>
            <Text className="text-meta font-semibold" style={{ color }} numberOfLines={1}>
              {parentName ? `${parentName} › ${previewName}` : previewName}
            </Text>
          </View>
          <Text className="text-label text-muted-foreground">How it looks in lists</Text>
        </View>

        <View className="px-4" style={{ gap: 12 }}>
          <View className="rounded-card bg-card border border-border p-4" style={{ gap: 14 }}>
            <Input label="Name" value={name} onChangeText={setName} placeholder="e.g., Food, Transport" maxLength={50} />

            {/* Sits under: makes this a sub-category (one level only) */}
            <View>
              <Text className="text-label font-semibold text-muted-foreground mb-1.5">Sits under</Text>
              <Pressable
                onPress={() => setShowParentSheet(true)}
                disabled={hasChildren}
                className="flex-row items-center px-3 rounded-control border border-border bg-card"
                style={{ minHeight: 44, opacity: hasChildren ? 0.6 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={`Sits under: ${parentName ?? "nothing, it's a main category"}`}
              >
                <Text className="flex-1 text-body text-foreground">{parentName ?? "Nothing - a main category"}</Text>
                <Ionicons name="chevron-down" size={18} color={theme.mutedForeground} />
              </Pressable>
              <Text className="text-label text-muted-foreground mt-1.5">
                {hasChildren
                  ? "This has sub-categories, so it stays a main category."
                  : parentName
                    ? `A sub-category of ${parentName}. Its spending counts toward ${parentName}'s budget. Pick "Nothing" to make it a main category.`
                    : "Pick a category to make this a sub-category of it, like Food › Groceries."}
              </Text>
            </View>
          </View>
          <SelectSheet<string>
            visible={showParentSheet}
            title="Sits under"
            options={[{ value: "__none", label: "Nothing - a main category" }, ...parentOptions.map((c) => ({ value: c.id, label: c.name }))]}
            value={parentId ?? "__none"}
            onChange={(v) => setParentId(v === "__none" ? null : v)}
            onClose={() => setShowParentSheet(false)}
            searchable={parentOptions.length > 8}
          />

          {/* Icon */}
          <View className="rounded-card bg-card border border-border p-4" style={{ gap: 12 }}>
            <Text className="text-heading font-bold text-foreground">Icon</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {quickIcons.map((ic) => {
                const on = ic === icon;
                return (
                  <Pressable
                    key={ic}
                    onPress={() => {
                      styleTouched.current = true;
                      setIcon(ic);
                    }}
                    className="items-center justify-center rounded-control"
                    style={{
                      width: "14.5%",
                      height: 44,
                      borderWidth: on ? 2 : 1,
                      borderColor: on ? color : theme.border,
                      backgroundColor: on ? tint(color, 0.1) : theme.card,
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={ic.replace(/-outline$/, "").replace(/-/g, " ")}
                  >
                    <Ionicons name={ic as keyof typeof Ionicons.glyphMap} size={20} color={on ? color : theme.mutedForeground} />
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setShowIconDrawer(true)} hitSlop={8} accessibilityRole="button" className="self-start">
              <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                All icons ›
              </Text>
            </Pressable>
          </View>

          {/* Colour */}
          <View className="rounded-card bg-card border border-border p-4" style={{ gap: 12 }}>
            <Text className="text-heading font-bold text-foreground">Colour</Text>
            <View className="flex-row flex-wrap items-center" style={{ gap: 10 }}>
              {quickColors.map((c) => {
                const on = c.toLowerCase() === color.toLowerCase();
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      styleTouched.current = true;
                      setColor(c);
                      setShowCustomColor(false);
                    }}
                    className="rounded-pill items-center justify-center"
                    style={{ width: 36, height: 36, backgroundColor: c, borderWidth: on ? 3 : 0, borderColor: theme.card }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Colour ${c}`}
                  >
                    {on && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setShowColorDrawer(true)}
                className="rounded-pill items-center justify-center px-3"
                style={{ height: 36, borderWidth: 1.5, borderStyle: "dashed", borderColor: theme.border }}
                accessibilityRole="button"
                accessibilityLabel="More colours or a custom colour"
              >
                <Text className="text-meta font-semibold text-muted-foreground">More · Custom #</Text>
              </Pressable>
            </View>
          </View>

          {/* Unavoidable */}
          <View className="rounded-card bg-card border border-border px-4 py-3.5 flex-row items-center" style={{ gap: 12 }}>
            <View className="flex-1">
              <Text className="text-body font-semibold text-foreground">Unavoidable</Text>
              <Text className="text-meta text-muted-foreground">Rent, insurance, EMIs. New spends here start as unavoidable in the Spending split</Text>
            </View>
            <Switch
              value={isUnavoidable}
              onValueChange={setIsUnavoidable}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Unavoidable"
            />
          </View>
        </View>
      </ScrollView>

      {/* Light footer: Delete (when editing) and Save */}
      <View className="bg-card border-t border-border px-4 pt-3 flex-row" style={{ gap: 10, paddingBottom: Math.max(insets.bottom, 12) }}>
        {isEditing && id && (
          <Pressable
            onPress={() => router.dismissTo({ pathname: "/settings/categories", params: { deleteId: id } })}
            className="rounded-pill items-center justify-center px-5"
            style={{ height: 48, borderWidth: 1, borderColor: theme.alpha("danger", 0.35), backgroundColor: theme.card }}
            accessibilityRole="button"
            accessibilityLabel="Delete this category"
          >
            <Text className="text-body font-semibold" style={{ color: theme.danger }}>
              Delete
            </Text>
          </Pressable>
        )}
        <View className="flex-1">
          <Button title={isEditing ? "Save category" : "Add category"} onPress={handleSave} loading={loading} />
        </View>
      </View>

      {/* Icon Picker Drawer */}
      <PickerDrawer
        visible={showIconDrawer}
        onClose={() => setShowIconDrawer(false)}
        title="Choose Icon"
      >
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          data={ICON_OPTIONS}
          keyExtractor={(item) => item}
          numColumns={6}
          renderItem={renderIconItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
          columnWrapperStyle={{ justifyContent: "center" }}
        />
      </PickerDrawer>

      {/* Color Picker Drawer */}
      <PickerDrawer
        visible={showColorDrawer}
        onClose={() => setShowColorDrawer(false)}
        title="Choose Color"
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <View className="flex-row flex-wrap mb-4">
            {COLOR_OPTIONS.map((c) => (
              <Pressable
                key={c}
                onPress={() => { styleTouched.current = true; setColor(c); setShowCustomColor(false); setShowColorDrawer(false); }}
                className={`w-12 h-12 rounded-full m-1.5 items-center justify-center ${
                  color === c && !showCustomColor ? "border-2 border-foreground" : ""
                }`}
                style={{ backgroundColor: c }}
              >
                {color === c && !showCustomColor && (
                  <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                )}
              </Pressable>
            ))}
          </View>
          {/* Custom hex code input */}
          {showCustomColor ? (
            <View className="flex-row items-center mb-2">
              <View
                className="w-10 h-10 rounded-full mr-3 border border-border"
                style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(customHex) ? customHex : "#CCCCCC" }}
              />
              <TextInput
                value={customHex}
                onChangeText={(t) => {
                  const hex = t.startsWith("#") ? t : "#" + t;
                  setCustomHex(hex);
                  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) { styleTouched.current = true; setColor(hex); }
                }}
                placeholder="#FF5733"
                placeholderTextColor={theme.faintForeground}
                maxLength={7}
                autoCapitalize="characters"
                className="flex-1 px-3 py-2 rounded-control border border-border bg-card text-foreground text-meta font-mono"
              />
              <Pressable
                onPress={() => { setShowCustomColor(false); setCustomHex(""); }}
                className="p-2 ml-2"
              >
                <Ionicons name="close" size={20} color={theme.mutedForeground} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setShowCustomColor(true);
                setCustomHex(color);
              }}
              className="flex-row items-center"
            >
              <Ionicons name="color-palette-outline" size={16} color={theme.mutedForeground} />
              <Text className="text-label text-muted-foreground ml-1">
                Custom hex color
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </PickerDrawer>
    </ScreenContainer>
  );
}
