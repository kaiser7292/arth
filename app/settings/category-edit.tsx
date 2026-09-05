import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable, TextInput, Modal, FlatList, Switch, Dimensions, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, Input, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import {
  getCategoryById,
  createCategory,
  updateCategory,
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

const SCREEN_HEIGHT = Dimensions.get("window").height;
const DRAWER_HEIGHT = SCREEN_HEIGHT * 0.55;

interface PickerDrawerProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function PickerDrawer({ visible, onClose, title, children }: PickerDrawerProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        {/* Backdrop */}
        <Pressable className="flex-1" onPress={onClose} />
        {/* Drawer */}
        <View
          style={{ height: DRAWER_HEIGHT, backgroundColor: colors.background }}
          className="rounded-t-2xl"
        >
          {/* Handle + header */}
          <View className="items-center pt-2 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>
          <View className="flex-row items-center justify-between px-4 pb-2">
            <Text className="text-base font-semibold text-foreground">
              {title}
            </Text>
            <Pressable onPress={onClose} className="p-1">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {/* Content */}
          <View className="flex-1 px-4 pb-4">
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function CategoryEditScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
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
        }
      });
    }
  }, [id]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Error", "Category name is required.");
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
      } else {
        await createCategory({
          user_id: DEFAULT_USER_ID,
          name: name.trim(),
          icon,
          color,
          is_unavoidable: isUnavoidable ? 1 : 0,
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
      onPress={() => { setIcon(iconName); setShowIconDrawer(false); }}
      className={`w-12 h-12 rounded-lg items-center justify-center m-1 ${
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
        color={icon === iconName ? colors.blue : "#6B7280"}
      />
    </Pressable>
  ), [icon, colorScheme, colors.blue]);

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 py-4">
          <Input
            label="Category Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g., Food, Transport"
            maxLength={50}
            containerClassName="mb-6"
          />

          {/* Icon picker — tap to open drawer */}
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Icon
          </Text>
          <Pressable
            onPress={() => setShowIconDrawer(true)}
            className="flex-row items-center px-4 py-3 rounded-lg border border-border mb-6"
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: color + "14" }}
            >
              <Ionicons
                name={icon as keyof typeof Ionicons.glyphMap}
                size={22}
                color={color}
              />
            </View>
            <Text className="flex-1 text-sm text-foreground">
              {icon.replace(/-outline$/, "").replace(/-/g, " ")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>

          {/* Color picker — tap to open drawer */}
          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Color
          </Text>
          <Pressable
            onPress={() => setShowColorDrawer(true)}
            className="flex-row items-center px-4 py-3 rounded-lg border border-border mb-6"
          >
            <View
              className="w-10 h-10 rounded-full mr-3 items-center justify-center"
              style={{ backgroundColor: color }}
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            </View>
            <Text className="flex-1 text-sm text-foreground">
              {color}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>

          {/* Unavoidable toggle */}
          <View className="flex-row items-center justify-between px-1 py-3 mb-6 border-b border-border">
            <View className="flex-1 mr-3">
              <Text className="text-sm font-medium text-foreground">
                Unavoidable Expense
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Rent, insurance, EMIs - expenses you can't skip
              </Text>
            </View>
            <Switch
              value={isUnavoidable}
              onValueChange={setIsUnavoidable}
              trackColor={{ false: "#E5E5E3", true: colors.blue }}
              thumbColor={isUnavoidable ? "#FFFFFF" : "#9CA3AF"}
            />
          </View>

          <Button
            title={isEditing ? "Update Category" : "Add Category"}
            onPress={handleSave}
            loading={loading}
          />
        </View>
      </ScrollView>

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
                onPress={() => { setColor(c); setShowCustomColor(false); setShowColorDrawer(false); }}
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
                  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) setColor(hex);
                }}
                placeholder="#FF5733"
                placeholderTextColor={colors.tabIconDefault}
                maxLength={7}
                autoCapitalize="characters"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm font-mono"
              />
              <Pressable
                onPress={() => { setShowCustomColor(false); setCustomHex(""); }}
                className="p-2 ml-2"
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
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
              <Ionicons name="color-palette-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-muted-foreground ml-1">
                Custom hex color
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </PickerDrawer>
    </ScreenContainer>
  );
}
