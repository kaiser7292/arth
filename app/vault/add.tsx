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
  decryptCustomFields,
  getVaultEntry,
  updateVaultEntry,
} from "@/services/vault";
import { getErrorMessage } from "@/utils/error-message";

const ALL_CATEGORIES = VAULT_CATEGORY_GROUPS.flatMap((g) => g.categories);

// Which login methods are sensible for each category (card + upi skip this picker)
const CATEGORY_LOGIN_METHODS: Record<VaultCategory, LoginMethod[]> = {
  banking:       ["password", "email_password", "google", "phone_otp"],
  card:          ["pin", "none"],
  upi:           ["pin"],
  demat:         ["password", "email_password", "phone_otp", "pin"],
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
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [linkedAccountId, setLinkedAccountId] = useState<string | undefined>(prefillLinkedAccountId);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Card-specific custom fields
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);

  // Banking extras + statement password (banking + card)
  const [secondaryPassword, setSecondaryPassword] = useState("");
  const [mpin, setMpin] = useState("");
  const [statementPwd, setStatementPwd] = useState("");
  const [showSecondaryPassword, setShowSecondaryPassword] = useState(false);
  const [showMpin, setShowMpin] = useState(false);
  const [showStatementPwd, setShowStatementPwd] = useState(false);

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
        if (entry.custom_fields) {
          const fields = await decryptCustomFields(entry.custom_fields);
          setCardNumber(fields.card_number ?? "");
          setCardHolder(fields.card_holder ?? "");
          setCardExpiry(fields.expiry ?? "");
          setCardCvv(fields.cvv ?? "");
          setSecondaryPassword(fields.secondary_password ?? "");
          setMpin(fields.mpin ?? "");
          setStatementPwd(fields.statement_password ?? "");
        }
        // passwords stay blank on edit — user must re-enter to change
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  const handleExpiryChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    setCardExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
  }, []);

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
      let resolvedMethod: LoginMethod = loginMethod;
      let customFieldsData: Record<string, string> | undefined;

      if (category === "card") {
        resolvedMethod = pin ? "pin" : "none";
        const cf: Record<string, string> = {};
        if (cardNumber.trim()) cf.card_number = cardNumber.trim();
        if (cardHolder.trim()) cf.card_holder = cardHolder.trim();
        if (cardExpiry.trim()) cf.expiry = cardExpiry.trim();
        if (cardCvv.trim()) cf.cvv = cardCvv.trim();
        if (statementPwd.trim()) cf.statement_password = statementPwd.trim();
        customFieldsData = cf;
      } else if (category === "upi") {
        resolvedMethod = "pin";
        customFieldsData = {};
      } else if (category === "banking") {
        const cf: Record<string, string> = {};
        if (secondaryPassword.trim()) cf.secondary_password = secondaryPassword.trim();
        if (mpin.trim()) cf.mpin = mpin.trim();
        if (statementPwd.trim()) cf.statement_password = statementPwd.trim();
        customFieldsData = cf;
      }

      const input = {
        title,
        category,
        login_method: resolvedMethod,
        username: username || undefined,
        email: email || undefined,
        phone: phone || undefined,
        password: password || undefined,
        pin: pin || undefined,
        url: url || undefined,
        notes: notes || undefined,
        linked_account_id: linkedAccountId,
        custom_fields_data: customFieldsData,
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
  }, [title, category, loginMethod, username, email, phone, password, pin, url, notes,
      cardNumber, cardHolder, cardExpiry, cardCvv, editId, linkedAccountId,
      secondaryPassword, mpin, statementPwd]);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  const isCard = category === "card";
  const isUpi = category === "upi";
  const showLoginMethodPicker = !isCard && !isUpi;

  const availableMethods = CATEGORY_LOGIN_METHODS[category];
  const showUsername = !isCard && !isUpi && loginMethod === "password";
  const showEmail = !isCard && !isUpi && ["email_password", "google", "apple"].includes(loginMethod);
  const showPhone = !isCard && !isUpi && loginMethod === "phone_otp";
  const showPassword_ = !isCard && !isUpi && ["password", "email_password"].includes(loginMethod);
  const showGenericPin = !isCard && !isUpi && loginMethod === "pin";

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

        {/* Category — dropdown */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
          Category
        </Text>
        <Pressable
          onPress={() => setCategoryOpen((o) => !o)}
          className="flex-row items-center border border-border-light dark:border-border-dark rounded-xl px-4 py-3 mb-1"
          style={{ backgroundColor: colors.surface }}
        >
          <Ionicons
            name={VAULT_CATEGORY_ICONS[category] as any}
            size={16}
            color={accent[500]}
          />
          <Text className="flex-1 text-sm text-text-primary dark:text-text-dark-primary ml-2">
            {VAULT_CATEGORY_LABELS[category]}
          </Text>
          <Ionicons
            name={categoryOpen ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textSecondary}
          />
        </Pressable>

        {categoryOpen && (
          <Card className="mb-4 p-0 overflow-hidden">
            {ALL_CATEGORIES.map((cat, idx) => {
              const selected = category === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => { setCategory(cat); setCategoryOpen(false); }}
                  className="flex-row items-center px-4 py-3"
                  style={{
                    backgroundColor: selected ? accent[500] + "18" : "transparent",
                    borderTopWidth: idx > 0 ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <Ionicons
                    name={VAULT_CATEGORY_ICONS[cat] as any}
                    size={14}
                    color={selected ? accent[500] : colors.textSecondary}
                  />
                  <Text
                    className="flex-1 text-sm ml-2.5"
                    style={{ color: selected ? accent[600] : colors.text }}
                  >
                    {VAULT_CATEGORY_LABELS[cat]}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={14} color={accent[500]} />
                  )}
                </Pressable>
              );
            })}
          </Card>
        )}

        <View className="h-px bg-border-light dark:bg-border-dark my-4" />

        {/* Card-specific fields */}
        {isCard && (
          <>
            <Field label="Cardholder Name (optional)" colors={colors}>
              <TextInput
                value={cardHolder}
                onChangeText={setCardHolder}
                placeholder="Name on card"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </Field>

            <Field label={editId ? "Card Number (leave blank to keep current)" : "Card Number"} colors={colors}>
              <TextInput
                value={cardNumber}
                onChangeText={setCardNumber}
                placeholder="XXXX XXXX XXXX XXXX"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showCardNumber}
                keyboardType="number-pad"
                maxLength={19}
                autoCorrect={false}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowCardNumber((p) => !p)} hitSlop={8}>
                <Ionicons
                  name={showCardNumber ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </Field>

            <Field label="Expiry (MM/YY)" colors={colors}>
              <TextInput
                value={cardExpiry}
                onChangeText={handleExpiryChange}
                placeholder="MM/YY"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                maxLength={5}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </Field>

            <Field label={editId ? "CVV (leave blank to keep current)" : "CVV"} colors={colors}>
              <TextInput
                value={cardCvv}
                onChangeText={setCardCvv}
                placeholder="CVV"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showCvv}
                keyboardType="number-pad"
                maxLength={4}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowCvv((p) => !p)} hitSlop={8}>
                <Ionicons
                  name={showCvv ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </Field>

            <Field label={editId ? "ATM / Card PIN (leave blank to keep current)" : "ATM / Card PIN (optional)"} colors={colors}>
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

            <Field label={editId ? "Statement PDF Password (leave blank to keep current)" : "Statement PDF Password (optional)"} colors={colors}>
              <TextInput
                value={statementPwd}
                onChangeText={setStatementPwd}
                placeholder="Password to open bank PDF statements"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showStatementPwd}
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowStatementPwd((p) => !p)} hitSlop={8}>
                <Ionicons
                  name={showStatementPwd ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </Field>
          </>
        )}

        {/* UPI-specific fields */}
        {isUpi && (
          <>
            <Field label="UPI ID (optional)" colors={colors}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="e.g. name@okicici"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </Field>

            <Field label="Registered Phone (optional)" colors={colors}>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 99999 99999"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </Field>

            <Field label={editId ? "UPI PIN (leave blank to keep current)" : "UPI PIN"} colors={colors}>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="4 or 6 digit PIN"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showPin}
                keyboardType="number-pad"
                maxLength={6}
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
          </>
        )}

        {/* Login method (hidden for card + upi) */}
        {showLoginMethodPicker && (
          <>
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
          </>
        )}

        {/* Standard credential fields (non-card, non-upi) */}
        {showUsername && (
          <Field label="Username / Login ID" colors={colors}>
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
          <Field label={loginMethod === "google" ? "Google Account" : loginMethod === "apple" ? "Apple ID" : "Email"} colors={colors}>
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
          <Field label="Phone Number" colors={colors}>
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
          <Field label={editId ? "New Password (leave blank to keep current)" : "Password"} colors={colors}>
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

        {/* Banking: secondary/transaction password + MPIN + statement PDF password */}
        {category === "banking" && ["password", "email_password"].includes(loginMethod) && (
          <>
            <Field label={editId ? "Transaction / Profile Password (leave blank to keep current)" : "Transaction / Profile Password (optional)"} colors={colors}>
              <TextInput
                value={secondaryPassword}
                onChangeText={setSecondaryPassword}
                placeholder="Secondary password, if any"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showSecondaryPassword}
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowSecondaryPassword((p) => !p)} hitSlop={8}>
                <Ionicons name={showSecondaryPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
              </Pressable>
            </Field>

            <Field label={editId ? "MPIN (leave blank to keep current)" : "MPIN (optional)"} colors={colors}>
              <TextInput
                value={mpin}
                onChangeText={setMpin}
                placeholder="4–6 digit MPIN for mobile banking app"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showMpin}
                keyboardType="number-pad"
                maxLength={6}
                className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
              />
              <Pressable onPress={() => setShowMpin((p) => !p)} hitSlop={8}>
                <Ionicons name={showMpin ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
              </Pressable>
            </Field>
          </>
        )}

        {category === "banking" && (
          <Field label={editId ? "Statement PDF Password (leave blank to keep current)" : "Statement PDF Password (optional)"} colors={colors}>
            <TextInput
              value={statementPwd}
              onChangeText={setStatementPwd}
              placeholder="Password to open bank PDF statements"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showStatementPwd}
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 text-sm text-text-primary dark:text-text-dark-primary"
            />
            <Pressable onPress={() => setShowStatementPwd((p) => !p)} hitSlop={8}>
              <Ionicons name={showStatementPwd ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
            </Pressable>
          </Field>
        )}

        {showGenericPin && (
          <Field
            label={
              category === "demat"
                ? editId ? "Trading PIN / TPIN (leave blank to keep current)" : "Trading PIN / TPIN"
                : editId ? "New PIN (leave blank to keep current)" : "PIN"
            }
            colors={colors}>
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

        {/* URL (optional, non-card, non-upi) */}
        {!isCard && !isUpi && (
          <Field label="Website / URL (optional)" colors={colors}>
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

function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: any;
  children: React.ReactNode;
}) {
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
