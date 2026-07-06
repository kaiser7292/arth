import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, ScreenContainer } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  LOGIN_METHOD_LABELS,
  LoginMethod,
  VAULT_CATEGORY_GROUPS,
  VAULT_CATEGORY_ICONS,
  VAULT_CATEGORY_LABELS,
  VaultCategory,
  createVaultEntry,
  getVaultEntry,
  updateVaultEntry,
} from "@/services/vault";
import { getErrorMessage } from "@/utils/error-message";

// Which login methods are sensible for each category
const CATEGORY_LOGIN_METHODS: Record<VaultCategory, LoginMethod[]> = {
  banking:       ["password", "email_password", "google", "phone_otp"],
  card:          ["pin", "none"],
  upi:           ["pin", "phone_otp", "password"],
  demat:         ["password", "email_password"],
  investment:    ["password", "email_password"],
  insurance:     ["password", "email_password"],
  statement_pwd: ["password"],
  email:         ["email_password", "google", "apple"],
  gaming:        ["password", "email_password", "google", "apple", "phone_otp"],
  subscription:  ["password", "email_password", "google", "apple", "phone_otp"],
  social:        ["password", "email_password", "google", "apple", "phone_otp"],
  other:         ["password", "email_password", "google", "apple", "phone_otp", "pin", "none"],
};

export default function VaultAddScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent } = useColorScheme();
  const params = useLocalSearchParams<{
    id?: string;
    linked_account_id?: string;
    prefill_category?: string;
    prefill_title?: string;
  }>();
  const editId = params.id;
  const prefillLinkedAccountId = params.linked_account_id;

  // Form state
  const [title, setTitle] = useState(
    params.prefill_title ? decodeURIComponent(params.prefill_title) : "",
  );
  const [category, setCategory] = useState<VaultCategory>(
    (params.prefill_category as VaultCategory) ?? "banking",
  );
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [linkedAccountId, setLinkedAccountId] = useState<string | undefined>(prefillLinkedAccountId);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Load existing entry for edit
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const entry = await getVaultEntry(editId);
        if (!entry) return;
        setTitle(entry.title);
        setCategory(entry.category as VaultCategory);
        setLoginMethod(entry.login_method as LoginMethod);
        setLinkedAccountId(entry.linked_account_id ?? undefined);
        setUsername(entry.username ?? "");
        setEmail(entry.email ?? "");
        setPhone(entry.phone ?? "");
        setUrl(entry.url ?? "");
        setNotes(entry.notes ?? "");
        setRenewalDate(entry.renewal_date ?? "");
        // passwords stay blank on edit — user must re-enter to change
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  // Reset login method when category changes (if current method not available)
  useEffect(() => {
    const available = CATEGORY_LOGIN_METHODS[category];
    if (!available.includes(loginMethod)) {
      setLoginMethod(available[0]);
    }
  }, [category]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      alert("Missing title", "Please enter a title for this entry.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title,
        category,
        login_method: loginMethod,
        username: username || undefined,
        email: email || undefined,
        phone: phone || undefined,
        password: password || undefined,
        pin: pin || undefined,
        url: url || undefined,
        notes: notes || undefined,
        renewal_date: renewalDate || undefined,
        linked_account_id: linkedAccountId,
      };
      if (editId) {
        await updateVaultEntry(editId, input);
      } else {
        await createVaultEntry(input);
      }
      router.back();
    } catch (e) {
      alert("Couldn't save", getErrorMessage(e, "Failed to save entry."));
    } finally {
      setSaving(false);
    }
  }, [title, category, loginMethod, username, email, phone, password, pin, url, notes, renewalDate, editId, linkedAccountId]);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  const availableMethods = CATEGORY_LOGIN_METHODS[category];
  const showUsername = loginMethod === "password";
  const showEmail = ["email_password", "google", "apple"].includes(loginMethod);
  const showPhone = loginMethod === "phone_otp";
  const showPassword_ = ["password", "email_password"].includes(loginMethod);
  const showPin_ = loginMethod === "pin";
  const showRenewal = category === "subscription";

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-1.5">
          Title
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. HDFC NetBanking, Netflix"
          placeholderTextColor={colors.textSecondary}
          autoFocus={!editId}
          returnKeyType="next"
          className="text-base text-text-primary dark:text-text-dark-primary bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark rounded-xl px-4 py-3 mb-5"
        />

        {/* Category */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
          Category
        </Text>
        {VAULT_CATEGORY_GROUPS.map((group) => (
          <View key={group.label} className="mb-3">
            <Text className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5 ml-1">
              {group.label}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {group.categories.map((cat) => {
                const selected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    className="flex-row items-center px-3 py-1.5 rounded-full border"
                    style={{
                      backgroundColor: selected ? accent[500] : "transparent",
                      borderColor: selected ? accent[500] : colors.border,
                    }}
                  >
                    <Ionicons
                      name={VAULT_CATEGORY_ICONS[cat] as any}
                      size={12}
                      color={selected ? "#fff" : colors.textSecondary}
                    />
                    <Text
                      className="text-xs font-medium ml-1"
                      style={{ color: selected ? "#fff" : colors.textSecondary }}
                    >
                      {VAULT_CATEGORY_LABELS[cat]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View className="h-px bg-border-light dark:bg-border-dark my-4" />

        {/* Login method */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
          How you log in
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          {availableMethods.map((method) => {
            const selected = loginMethod === method;
            return (
              <Pressable
                key={method}
                onPress={() => setLoginMethod(method)}
                className="px-3 py-1.5 rounded-full border"
                style={{
                  backgroundColor: selected ? accent[100] : "transparent",
                  borderColor: selected ? accent[500] : colors.border,
                }}
              >
                <Text
                  className="text-xs font-medium"
                  style={{ color: selected ? accent[700] : colors.textSecondary }}
                >
                  {LOGIN_METHOD_LABELS[method]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Credential fields */}
        {showUsername && (
          <Field label="Username / Login ID">
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
          </Field>
        )}

        {showEmail && (
          <Field label={loginMethod === "google" ? "Google Account" : loginMethod === "apple" ? "Apple ID" : "Email"}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
          </Field>
        )}

        {showPhone && (
          <Field label="Phone Number">
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 99999 99999"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
          </Field>
        )}

        {showPassword_ && (
          <Field label={editId ? "New Password (leave blank to keep current)" : "Password"}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={editId ? "Enter new password to change" : "Password"}
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
            <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          </Field>
        )}

        {showPin_ && (
          <Field label={editId ? "New PIN (leave blank to keep current)" : "PIN"}>
            <TextInput
              value={pin}
              onChangeText={setPin}
              placeholder="PIN"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showPin}
              keyboardType="number-pad"
              maxLength={8}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
            <Pressable onPress={() => setShowPin((p) => !p)} hitSlop={8}>
              <Ionicons
                name={showPin ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          </Field>
        )}

        <View className="h-px bg-border-light dark:bg-border-dark my-2" />

        {/* URL (optional, most categories) */}
        {category !== "card" && category !== "upi" && (
          <Field label="Website / URL (optional)">
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="url"
              autoCorrect={false}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
          </Field>
        )}

        {/* Renewal date for subscriptions */}
        {showRenewal && (
          <Field label="Renewal Date (optional)">
            <TextInput
              value={renewalDate}
              onChangeText={setRenewalDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
          </Field>
        )}

        {/* Notes */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mt-4 mb-1.5">
          Notes (optional)
        </Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any extra info — IVR steps, secret questions, etc."
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className="text-sm text-text-primary dark:text-text-dark-primary bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark rounded-xl px-4 py-3 mb-6"
          style={{ minHeight: 80 }}
        />

        {/* Save button */}
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="py-4 rounded-2xl items-center"
          style={{ backgroundColor: accent[500] }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">
              {editId ? "Save Changes" : "Save to Vault"}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useColorScheme();
  return (
    <View className="mb-3">
      <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-1.5">
        {label}
      </Text>
      <View
        className="flex-row items-center border border-border-light dark:border-border-dark rounded-xl px-4 py-3"
        style={{ backgroundColor: colors.surface }}
      >
        {children}
      </View>
    </View>
  );
}
