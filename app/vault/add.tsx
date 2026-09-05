import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { Card, ScreenContainer, Text } from "@/components/ui";
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
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const ALL_CATEGORIES = VAULT_CATEGORY_GROUPS.flatMap((g) => g.categories);

// Which login methods are sensible for each category (card + upi skip this picker)
const CATEGORY_LOGIN_METHODS: Record<VaultCategory, LoginMethod[]> = {
  banking:       ["password", "email_password", "google", "phone_otp", "pin"],
  card:          ["pin", "none"],
  upi:           ["pin"],
  demat:         ["password", "email_password", "google", "apple", "phone_otp"],
  statement_pwd: ["password"],   // legacy — not shown in picker, kept for existing entries
  email:         ["email_password", "google", "apple"],
  gaming:        ["password", "email_password", "google", "apple", "phone_otp"],
  subscription:  ["email_password", "google", "apple", "password", "phone_otp"],
  social:        ["email_password", "google", "apple", "password", "phone_otp"],
  other:         ["password", "email_password", "google", "apple", "phone_otp", "pin", "none"],
};

export default function VaultAddScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
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
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Card-specific custom fields
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);

  // Banking extras
  const [secondaryPassword, setSecondaryPassword] = useState("");
  const [mpin, setMpin] = useState("");
  const [showSecondaryPassword, setShowSecondaryPassword] = useState(false);
  const [showMpin, setShowMpin] = useState(false);
  // Demat extras
  const [tpin, setTpin] = useState("");
  const [showTpin, setShowTpin] = useState(false);
  // Statement PDF password (banking + card + demat)
  const [statementPwd, setStatementPwd] = useState("");
  const [showStatementPwd, setShowStatementPwd] = useState(false);

  useEffect(() => {
    getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch(() => {});
  }, []);

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
        let expandMore = !!(entry.url || entry.notes);
        if (entry.custom_fields) {
          const fields = await decryptCustomFields(entry.custom_fields);
          setCardNumber(fields.card_number ?? "");
          setCardHolder(fields.card_holder ?? "");
          setCardExpiry(fields.expiry ?? "");
          setCardCvv(fields.cvv ?? "");
          setSecondaryPassword(fields.secondary_password ?? "");
          setMpin(fields.mpin ?? "");
          setTpin(fields.tpin ?? "");
          setStatementPwd(fields.statement_password ?? "");
          if (fields.secondary_password || fields.mpin || fields.tpin || fields.statement_password) {
            expandMore = true;
          }
        }
        if (expandMore) setShowMore(true);
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

  const handleCardNumberChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 16);
    const parts: string[] = [];
    for (let i = 0; i < digits.length; i += 4) parts.push(digits.slice(i, i + 4));
    setCardNumber(parts.join("-"));
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
      } else if (category === "demat") {
        const cf: Record<string, string> = {};
        if (tpin.trim()) cf.tpin = tpin.trim();
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
      secondaryPassword, mpin, tpin, statementPwd]);

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
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Title
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. HDFC NetBanking, Netflix"
          placeholderTextColor={colors.textSecondary}
          autoFocus={!editId}
          returnKeyType="next"
          className="text-base text-foreground bg-card-light border border-border rounded-xl px-4 py-3 mb-5"
        />

        {/* Account Type — dropdown */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Account Type
        </Text>
        <Pressable
          onPress={() => setCategoryOpen((o) => !o)}
          className="flex-row items-center border border-border rounded-xl px-4 py-3 mb-1"
          style={{ backgroundColor: colors.surface }}
        >
          <Ionicons
            name={VAULT_CATEGORY_ICONS[category] as any}
            size={16}
            color={theme.primary}
          />
          <Text className="flex-1 text-sm text-foreground ml-2">
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
                    backgroundColor: selected ? theme.alpha("primary", 0.09) : "transparent",
                    borderTopWidth: idx > 0 ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <Ionicons
                    name={VAULT_CATEGORY_ICONS[cat] as any}
                    size={14}
                    color={selected ? theme.primary : colors.textSecondary}
                  />
                  <Text
                    className="flex-1 text-sm ml-2.5"
                    style={{ color: selected ? theme.primary : colors.text }}
                  >
                    {VAULT_CATEGORY_LABELS[cat]}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={14} color={theme.primary} />
                  )}
                </Pressable>
              );
            })}
          </Card>
        )}

        {/* Linked Arth account — shown for banking/card/demat/statement_pwd */}
        {(category === "banking" || category === "card" || category === "demat" || category === "statement_pwd") && accounts.length > 0 && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1.5">
              Linked Arth Account (optional)
            </Text>
            <Pressable
              onPress={() => setAccountPickerOpen((o) => !o)}
              className="flex-row items-center border border-border rounded-xl px-4 py-3 mb-1"
              style={{ backgroundColor: colors.surface }}
            >
              <Ionicons
                name="wallet-outline"
                size={16}
                color={linkedAccountId ? theme.primary : colors.textSecondary}
              />
              <Text
                className="flex-1 text-sm ml-2"
                style={{ color: linkedAccountId ? colors.text : colors.textSecondary }}
              >
                {linkedAccountId
                  ? (accounts.find((a) => a.id === linkedAccountId)?.account_label ||
                     accounts.find((a) => a.id === linkedAccountId)?.bank_name ||
                     "Unknown account")
                  : "None — tap to link"}
              </Text>
              <Ionicons
                name={accountPickerOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textSecondary}
              />
            </Pressable>
            {accountPickerOpen && (
              <View className="border border-border rounded-xl mb-4 overflow-hidden">
                <Pressable
                  onPress={() => { setLinkedAccountId(undefined); setAccountPickerOpen(false); }}
                  className="flex-row items-center px-4 py-3"
                  style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Ionicons name="close-circle-outline" size={14} color={colors.textSecondary} />
                  <Text className="text-sm text-muted-foreground ml-2">
                    None
                  </Text>
                </Pressable>
                {accounts.map((acc, idx) => {
                  const selected = linkedAccountId === acc.id;
                  return (
                    <Pressable
                      key={acc.id}
                      onPress={() => { setLinkedAccountId(acc.id); setAccountPickerOpen(false); }}
                      className="flex-row items-center px-4 py-3"
                      style={{
                        backgroundColor: selected ? theme.alpha("primary", 0.09) : "transparent",
                        borderTopWidth: idx > 0 ? 1 : 0,
                        borderTopColor: colors.border,
                      }}
                    >
                      <Ionicons
                        name="wallet-outline"
                        size={14}
                        color={selected ? theme.primary : colors.textSecondary}
                      />
                      <View className="flex-1 ml-2.5">
                        <Text
                          className="text-sm"
                          style={{ color: selected ? theme.primary : colors.text }}
                        >
                          {acc.account_label || acc.bank_name}
                        </Text>
                        {acc.account_identifier ? (
                          <Text className="text-xs text-muted-foreground">
                            ****{acc.account_identifier}
                          </Text>
                        ) : null}
                      </View>
                      {selected && (
                        <Ionicons name="checkmark" size={14} color={theme.primary} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text className="text-xs text-muted-foreground mb-3 -mt-1">
              Link to an account so Arth can auto-fill this password when reconciling statements.
            </Text>
          </>
        )}

        <View className="h-px bg-border my-4" />

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
                className="flex-1 text-sm text-foreground"
              />
            </Field>

            <Field label={editId ? "Card Number (leave blank to keep current)" : "Card Number"} colors={colors}>
              <TextInput
                value={cardNumber}
                onChangeText={handleCardNumberChange}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showCardNumber}
                keyboardType="number-pad"
                maxLength={19}
                autoCorrect={false}
                className="flex-1 text-sm text-foreground"
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
                className="flex-1 text-sm text-foreground"
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
                className="flex-1 text-sm text-foreground"
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
                className="flex-1 text-sm text-foreground"
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
                className="flex-1 text-sm text-foreground"
              />
            </Field>

            <Field label="Registered Phone (optional)" colors={colors}>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 99999 99999"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                className="flex-1 text-sm text-foreground"
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
                className="flex-1 text-sm text-foreground"
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
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                      backgroundColor: selected ? theme.alpha("primary", 0.1) : "transparent",
                      borderColor: selected ? theme.primary : colors.border,
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: selected ? theme.primary : colors.textSecondary }}
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
              className="flex-1 text-sm text-foreground"
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
              className="flex-1 text-sm text-foreground"
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
              className="flex-1 text-sm text-foreground"
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
              className="flex-1 text-sm text-foreground"
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

        {showGenericPin && (
          <Field
            label={editId ? "New PIN (leave blank to keep current)" : "PIN"}
            colors={colors}>
            <TextInput
              value={pin}
              onChangeText={setPin}
              placeholder="PIN"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showPin}
              keyboardType="number-pad"
              maxLength={8}
              className="flex-1 text-sm text-foreground"
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

        {/* ── More fields toggle ── */}
        <Pressable
          onPress={() => setShowMore((o) => !o)}
          className="flex-row items-center justify-center py-3 my-1"
        >
          <Ionicons
            name={showMore ? "remove-circle-outline" : "add-circle-outline"}
            size={16}
            color={theme.primary}
          />
          <Text className="text-sm font-medium ml-1.5" style={{ color: theme.primary }}>
            {showMore ? "Hide extra fields" : "More fields"}
          </Text>
        </Pressable>

        {/* ── Collapsed section ── */}
        {showMore && (
          <>
            {/* Banking extras */}
            {category === "banking" && (
              <>
                <Field label={editId ? "Transaction / Profile Password (leave blank to keep current)" : "Transaction / Profile Password (optional)"} colors={colors}>
                  <TextInput
                    value={secondaryPassword}
                    onChangeText={setSecondaryPassword}
                    placeholder="Secondary password for transfers / profile changes"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showSecondaryPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 text-sm text-foreground"
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
                    className="flex-1 text-sm text-foreground"
                  />
                  <Pressable onPress={() => setShowMpin((p) => !p)} hitSlop={8}>
                    <Ionicons name={showMpin ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
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
                    className="flex-1 text-sm text-foreground"
                  />
                  <Pressable onPress={() => setShowStatementPwd((p) => !p)} hitSlop={8}>
                    <Ionicons name={showStatementPwd ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
                  </Pressable>
                </Field>
              </>
            )}

            {/* Card statement PDF password */}
            {isCard && (
              <Field label={editId ? "Statement PDF Password (leave blank to keep current)" : "Statement PDF Password (optional)"} colors={colors}>
                <TextInput
                  value={statementPwd}
                  onChangeText={setStatementPwd}
                  placeholder="Password to open bank PDF statements"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry={!showStatementPwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 text-sm text-foreground"
                />
                <Pressable onPress={() => setShowStatementPwd((p) => !p)} hitSlop={8}>
                  <Ionicons name={showStatementPwd ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
                </Pressable>
              </Field>
            )}

            {/* Demat extras */}
            {category === "demat" && (
              <>
                <Field label={editId ? "Trading PIN / TPIN (leave blank to keep current)" : "Trading PIN / TPIN (optional)"} colors={colors}>
                  <TextInput
                    value={tpin}
                    onChangeText={setTpin}
                    placeholder="PIN for authorising trades / debit"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showTpin}
                    keyboardType="number-pad"
                    maxLength={8}
                    className="flex-1 text-sm text-foreground"
                  />
                  <Pressable onPress={() => setShowTpin((p) => !p)} hitSlop={8}>
                    <Ionicons name={showTpin ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
                  </Pressable>
                </Field>

                <Field label={editId ? "Statement PDF Password (leave blank to keep current)" : "Statement PDF Password (optional)"} colors={colors}>
                  <TextInput
                    value={statementPwd}
                    onChangeText={setStatementPwd}
                    placeholder="Password to open contract notes / P&L PDFs"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showStatementPwd}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 text-sm text-foreground"
                  />
                  <Pressable onPress={() => setShowStatementPwd((p) => !p)} hitSlop={8}>
                    <Ionicons name={showStatementPwd ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
                  </Pressable>
                </Field>
              </>
            )}

            <View className="h-px bg-border my-2" />

            {/* URL */}
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
                  className="flex-1 text-sm text-foreground"
                />
              </Field>
            )}

            {/* Notes */}
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-1.5">
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
              className="text-sm text-foreground bg-card-light border border-border rounded-xl px-4 py-3 mb-2"
              style={{ minHeight: 80 }}
            />
          </>
        )}

        {/* Save button */}
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="py-4 rounded-2xl items-center mt-4"
          style={{ backgroundColor: theme.primary }}
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
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </Text>
      <View
        className="flex-row items-center border border-border rounded-xl px-4 py-3"
        style={{ backgroundColor: colors.surface }}
      >
        {children}
      </View>
    </View>
  );
}
