import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  LOGIN_METHOD_LABELS,
  VAULT_CATEGORY_ICONS,
  VAULT_CATEGORY_LABELS,
  VaultEntry,
  decryptCustomFields,
  decryptField,
  deleteVaultEntry,
  getVaultEntry,
} from "@/services/vault";

const CLIPBOARD_TTL_MS = 30_000;

export default function VaultEntryScreen() {
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();

  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState<string | null>(null);
  const [pin, setPinVal] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showSecondaryPassword, setShowSecondaryPassword] = useState(false);
  const [showMpin, setShowMpin] = useState(false);
  const [showTpin, setShowTpin] = useState(false);
  const [showStatementPwd, setShowStatementPwd] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [clipboardSecsLeft, setClipboardSecsLeft] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!entryId) return;
    try {
      const e = await getVaultEntry(entryId);
      setEntry(e);
      if (e?.password_enc) {
        const p = await decryptField(e.password_enc);
        setPassword(p);
      }
      if (e?.pin_enc) {
        const p = await decryptField(e.pin_enc);
        setPinVal(p);
      }
      if (e?.custom_fields) {
        const cf = await decryptCustomFields(e.custom_fields);
        setCustomFields(cf);
      }
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startClipboardCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setClipboardSecsLeft(30);
    const start = Date.now();
    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.ceil((CLIPBOARD_TTL_MS - elapsed) / 1000);
      if (left <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        Clipboard.setStringAsync("");
        setCopiedField(null);
        setClipboardSecsLeft(0);
      } else {
        setClipboardSecsLeft(left);
      }
    }, 500);
  }, []);

  const handleCopy = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedField(label);
    startClipboardCountdown();
  }, [startClipboardCountdown]);

  const handleDelete = useCallback(() => {
    if (!entry) return;
    alert(
      "Delete Entry",
      `Delete "${entry.title}" from your vault? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteVaultEntry(entry.id);
            router.back();
          },
        },
      ],
    );
  }, [entry, alert, router]);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  if (!entry) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Entry not found.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const isCard = entry.category === "card";
  const isUpi = entry.category === "upi";
  const showUsername = !isCard && !isUpi && entry.login_method === "password";
  const showEmail = !isCard && !isUpi && ["email_password", "google", "apple"].includes(entry.login_method);
  const showPhone = !isCard && !isUpi && entry.login_method === "phone_otp";
  const showPasswordField = !isCard && !isUpi && ["password", "email_password"].includes(entry.login_method);
  const showPinField = !isCard && !isUpi && entry.login_method === "pin";

  return (
    <ScreenContainer padTop={false}>
      {/* Clipboard banner */}
      {copiedField && (
        <View
          className="mx-4 mt-3 px-4 py-2.5 rounded-xl flex-row items-center justify-between"
          style={{ backgroundColor: accent[500] + "22" }}
        >
          <Text className="text-sm font-medium" style={{ color: accent[700] }}>
            {copiedField} copied — clears in {clipboardSecsLeft}s
          </Text>
          <Pressable
            onPress={() => {
              if (countdownRef.current) clearInterval(countdownRef.current);
              Clipboard.setStringAsync("");
              setCopiedField(null);
            }}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color={accent[700]} />
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header card */}
        <Card className="mb-4">
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: accent[500] + "22" }}
            >
              <Ionicons
                name={VAULT_CATEGORY_ICONS[entry.category as keyof typeof VAULT_CATEGORY_ICONS] as any}
                size={20}
                color={accent[500]}
              />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">
                {entry.title}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {VAULT_CATEGORY_LABELS[entry.category as keyof typeof VAULT_CATEGORY_LABELS]}
                {" · "}
                {LOGIN_METHOD_LABELS[entry.login_method as keyof typeof LOGIN_METHOD_LABELS]}
              </Text>
            </View>
          </View>

          {/* Action row */}
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => router.push({ pathname: "/vault/add", params: { id: entry.id } })}
              className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl border border-border"
            >
              <Ionicons name="pencil-outline" size={14} color={colors.textSecondary} />
              <Text className="text-sm font-medium text-muted-foreground ml-1.5">
                Edit
              </Text>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              className="flex-row items-center justify-center px-4 py-2.5 rounded-xl border border-border"
            >
              <Ionicons name="trash-outline" size={14} color="#EF4444" />
            </Pressable>
          </View>
        </Card>

        {/* Card-specific fields */}
        {isCard && customFields.card_holder && (
          <FieldRow
            label="Cardholder Name"
            value={customFields.card_holder}
            onCopy={() => handleCopy("Cardholder Name", customFields.card_holder)}
            copied={copiedField === "Cardholder Name"}
            accent={accent}
          />
        )}
        {isCard && customFields.card_number && (
          <SecretRow
            label="Card Number"
            value={formatCardNumber(customFields.card_number)}
            show={showCardNumber}
            onToggle={() => setShowCardNumber((p) => !p)}
            onCopy={() => handleCopy("Card Number", formatCardNumber(customFields.card_number))}
            copied={copiedField === "Card Number"}
            accent={accent}
            colors={colors}
          />
        )}
        {isCard && customFields.expiry && (
          <FieldRow
            label="Expiry"
            value={customFields.expiry}
            onCopy={() => handleCopy("Expiry", customFields.expiry)}
            copied={copiedField === "Expiry"}
            accent={accent}
          />
        )}
        {isCard && customFields.cvv && (
          <SecretRow
            label="CVV"
            value={customFields.cvv}
            show={showCvv}
            onToggle={() => setShowCvv((p) => !p)}
            onCopy={() => handleCopy("CVV", customFields.cvv)}
            copied={copiedField === "CVV"}
            accent={accent}
            colors={colors}
          />
        )}
        {isCard && pin && (
          <SecretRow
            label="ATM / Card PIN"
            value={pin}
            show={showPin}
            onToggle={() => setShowPin((p) => !p)}
            onCopy={() => handleCopy("PIN", pin)}
            copied={copiedField === "PIN"}
            accent={accent}
            colors={colors}
          />
        )}
        {isCard && customFields.statement_password && (
          <SecretRow
            label="Statement PDF Password"
            value={customFields.statement_password}
            show={showStatementPwd}
            onToggle={() => setShowStatementPwd((p) => !p)}
            onCopy={() => handleCopy("Statement PDF Password", customFields.statement_password)}
            copied={copiedField === "Statement PDF Password"}
            accent={accent}
            colors={colors}
          />
        )}

        {/* UPI-specific fields */}
        {isUpi && entry.username && (
          <FieldRow
            label="UPI ID"
            value={entry.username}
            onCopy={() => handleCopy("UPI ID", entry.username!)}
            copied={copiedField === "UPI ID"}
            accent={accent}
          />
        )}
        {isUpi && entry.phone && (
          <FieldRow
            label="Registered Phone"
            value={entry.phone}
            onCopy={() => handleCopy("Phone", entry.phone!)}
            copied={copiedField === "Phone"}
            accent={accent}
          />
        )}
        {isUpi && pin && (
          <SecretRow
            label="UPI PIN"
            value={pin}
            show={showPin}
            onToggle={() => setShowPin((p) => !p)}
            onCopy={() => handleCopy("UPI PIN", pin)}
            copied={copiedField === "UPI PIN"}
            accent={accent}
            colors={colors}
          />
        )}

        {/* Standard credential fields */}
        {showUsername && entry.username && (
          <FieldRow
            label="Username"
            value={entry.username}
            onCopy={() => handleCopy("Username", entry.username!)}
            copied={copiedField === "Username"}
            accent={accent}
          />
        )}

        {showEmail && entry.email && (
          <FieldRow
            label={entry.login_method === "google" ? "Google Account" : entry.login_method === "apple" ? "Apple ID" : "Email"}
            value={entry.email}
            onCopy={() => handleCopy("Email", entry.email!)}
            copied={copiedField === "Email"}
            accent={accent}
          />
        )}

        {showPhone && entry.phone && (
          <FieldRow
            label="Phone Number"
            value={entry.phone}
            onCopy={() => handleCopy("Phone", entry.phone!)}
            copied={copiedField === "Phone"}
            accent={accent}
          />
        )}

        {showPasswordField && password && (
          <SecretRow
            label="Password"
            value={password}
            show={showPassword}
            onToggle={() => setShowPassword((p) => !p)}
            onCopy={() => handleCopy("Password", password)}
            copied={copiedField === "Password"}
            accent={accent}
            colors={colors}
          />
        )}

        {entry.category === "banking" && customFields.secondary_password && (
          <SecretRow
            label="Transaction / Profile Password"
            value={customFields.secondary_password}
            show={showSecondaryPassword}
            onToggle={() => setShowSecondaryPassword((p) => !p)}
            onCopy={() => handleCopy("Transaction / Profile Password", customFields.secondary_password)}
            copied={copiedField === "Transaction / Profile Password"}
            accent={accent}
            colors={colors}
          />
        )}

        {entry.category === "banking" && customFields.mpin && (
          <SecretRow
            label="MPIN"
            value={customFields.mpin}
            show={showMpin}
            onToggle={() => setShowMpin((p) => !p)}
            onCopy={() => handleCopy("MPIN", customFields.mpin)}
            copied={copiedField === "MPIN"}
            accent={accent}
            colors={colors}
          />
        )}

        {/* Legacy: demat entries saved with login_method=pin before TPIN moved to extras */}
        {showPinField && pin && (
          <SecretRow
            label={entry.category === "demat" ? "Trading PIN / TPIN" : "PIN"}
            value={pin}
            show={showPin}
            onToggle={() => setShowPin((p) => !p)}
            onCopy={() => handleCopy("PIN", pin)}
            copied={copiedField === "PIN"}
            accent={accent}
            colors={colors}
          />
        )}

        {/* Demat extras */}
        {entry.category === "demat" && customFields.tpin && (
          <SecretRow
            label="Trading PIN / TPIN"
            value={customFields.tpin}
            show={showTpin}
            onToggle={() => setShowTpin((p) => !p)}
            onCopy={() => handleCopy("Trading PIN / TPIN", customFields.tpin)}
            copied={copiedField === "Trading PIN / TPIN"}
            accent={accent}
            colors={colors}
          />
        )}

        {/* Statement PDF Password — banking and demat */}
        {(entry.category === "banking" || entry.category === "demat") && customFields.statement_password && (
          <SecretRow
            label="Statement PDF Password"
            value={customFields.statement_password}
            show={showStatementPwd}
            onToggle={() => setShowStatementPwd((p) => !p)}
            onCopy={() => handleCopy("Statement PDF Password", customFields.statement_password)}
            copied={copiedField === "Statement PDF Password"}
            accent={accent}
            colors={colors}
          />
        )}

        {entry.url && (
          <FieldRow
            label="Website"
            value={entry.url}
            onCopy={() => handleCopy("URL", entry.url!)}
            copied={copiedField === "URL"}
            accent={accent}
          />
        )}

        {entry.notes && (
          <View className="mt-2">
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notes
              </Text>
              <Pressable onPress={() => handleCopy("Notes", entry.notes!)} hitSlop={8}>
                <Ionicons
                  name={copiedField === "Notes" ? "checkmark" : "copy-outline"}
                  size={14}
                  color={copiedField === "Notes" ? accent[500] : colors.textSecondary}
                />
              </Pressable>
            </View>
            <Card>
              <Text selectable className="text-sm text-foreground leading-5">
                {entry.notes}
              </Text>
            </Card>
          </View>
        )}

        <Text className="text-label text-faint-foreground text-center mt-6">
          Added {new Date(entry.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          {entry.updated_at ? ` · Updated ${new Date(entry.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 16) return raw;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function FieldRow({
  label,
  value,
  onCopy,
  copied,
  accent,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  accent: any;
}) {
  const { colors } = useColorScheme();
  return (
    <View className="mb-3">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </Text>
      <View
        className="flex-row items-center border border-border rounded-xl px-4 py-3"
        style={{ backgroundColor: colors.surface }}
      >
        <Text className="flex-1 text-sm text-foreground" selectable>
          {value}
        </Text>
        {onCopy && (
          <Pressable onPress={onCopy} hitSlop={8}>
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={16}
              color={copied ? accent[500] : colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SecretRow({
  label,
  value,
  show,
  onToggle,
  onCopy,
  copied,
  accent,
  colors,
}: {
  label: string;
  value: string;
  show: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  accent: any;
  colors: any;
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
        <Text className="flex-1 text-sm text-foreground font-mono tracking-widest">
          {show ? value : "•".repeat(Math.min(value.length, 12))}
        </Text>
        <Pressable onPress={onToggle} hitSlop={8} className="mr-3">
          <Ionicons
            name={show ? "eye-off-outline" : "eye-outline"}
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={16}
            color={copied ? accent[500] : colors.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );
}
