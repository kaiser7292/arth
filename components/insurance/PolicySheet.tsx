import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { DateInput, Input, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";


import { DEFAULT_USER_ID } from "@/constants/app";
import {
  addPolicy,
  updatePolicy,
  deletePolicy,
  type InsurancePolicy,
  type InsurancePolicyInput,
  type PolicyType,
  type PremiumFrequency,
} from "@/services/insurance-policy";
import { useTheme } from "@/hooks/use-theme";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  policy?: InsurancePolicy | null;
}

const POLICY_TYPES: Array<{ value: PolicyType; label: string }> = [
  { value: "term", label: "Term" },
  { value: "health", label: "Health" },
  { value: "home", label: "Home" },
  { value: "car", label: "Car" },
  { value: "life", label: "Life" },
  { value: "other", label: "Other" },
];

const FREQ_OPTIONS: Array<{ value: PremiumFrequency; label: string }> = [
  { value: "annual", label: "Annual" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
];

export function PolicySheet({ visible, onClose, onSaved, policy }: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const isEdit = !!policy;

  const [policyType, setPolicyType] = useState<PolicyType>("term");
  const [providerName, setProviderName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [sumInsured, setSumInsured] = useState("");
  const [annualPremium, setAnnualPremium] = useState("");
  const [premiumFreq, setPremiumFreq] = useState<PremiumFrequency>("annual");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [coversFamily, setCoversFamily] = useState(false);
  const [familyMembers, setFamilyMembers] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      if (policy) {
        setPolicyType(policy.policy_type);
        setProviderName(policy.provider_name);
        setPolicyNumber(policy.policy_number ?? "");
        setSumInsured(String(policy.sum_insured));
        setAnnualPremium(String(policy.annual_premium));
        setPremiumFreq(policy.premium_frequency);
        setStartDate(policy.start_date ?? "");
        setExpiryDate(policy.expiry_date ?? "");
        setCoversFamily(policy.covers_family === 1);
        setFamilyMembers(String(policy.family_members_covered));
        setNotes(policy.notes ?? "");
      } else {
        setPolicyType("term");
        setProviderName("");
        setPolicyNumber("");
        setSumInsured("");
        setAnnualPremium("");
        setPremiumFreq("annual");
        setStartDate("");
        setExpiryDate("");
        setCoversFamily(false);
        setFamilyMembers("1");
        setNotes("");
      }
    }
  }, [visible, policy]);

  const handleSave = async () => {
    if (!providerName.trim()) {
      Alert.alert("Missing field", "Provider name is required.");
      return;
    }
    const sum = parseFloat(sumInsured) || 0;
    if (sum <= 0) {
      Alert.alert("Missing field", "Sum insured must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const input: InsurancePolicyInput = {
        policy_type: policyType,
        provider_name: providerName.trim(),
        policy_number: policyNumber.trim() || undefined,
        sum_insured: sum,
        annual_premium: parseFloat(annualPremium) || 0,
        premium_frequency: premiumFreq,
        start_date: startDate || undefined,
        expiry_date: expiryDate || undefined,
        covers_family: coversFamily ? 1 : 0,
        family_members_covered: parseInt(familyMembers, 10) || 1,
        notes: notes.trim() || undefined,
      };

      if (isEdit && policy) {
        await updatePolicy(policy.id, input);
      } else {
        await addPolicy(DEFAULT_USER_ID, input);
      }
      onSaved();
    } catch (e) {
      Alert.alert("Error", "Could not save policy. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!policy) return;
    Alert.alert("Delete Policy", `Delete "${policy.provider_name}" policy?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deletePolicy(policy.id);
          onSaved();
        },
      },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Text className="text-base font-bold text-foreground">
          {isEdit ? "Edit Policy" : "Add Policy"}
        </Text>
        {isEdit && (
          <Pressable onPress={handleDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Policy type chips */}
        <Text className="text-xs font-semibold text-muted-foreground mb-1.5 mt-2">
          Policy Type
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {POLICY_TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => setPolicyType(t.value)}
              className="px-3 py-1.5 rounded-full border"
              style={{
                borderColor: policyType === t.value ? theme.primary : colors.border,
                backgroundColor: policyType === t.value ? theme.primary + "18" : "transparent",
              }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: policyType === t.value ? theme.primary : colors.textSecondary }}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Input
          label="Provider Name"
          value={providerName}
          onChangeText={setProviderName}
          placeholder="e.g. HDFC Life, Star Health"
          containerClassName="mb-3"
        />

        <Input
          label="Policy Number (optional)"
          value={policyNumber}
          onChangeText={setPolicyNumber}
          placeholder="e.g. POL-12345678"
          containerClassName="mb-3"
        />

        <Input
          label="Sum Insured (₹)"
          value={sumInsured}
          onChangeText={setSumInsured}
          keyboardType="numeric"
          placeholder="e.g. 10000000"
          formula
          containerClassName="mb-3"
        />

        <Input
          label="Annual Premium (₹)"
          value={annualPremium}
          onChangeText={setAnnualPremium}
          keyboardType="numeric"
          placeholder="e.g. 15000"
          formula
          containerClassName="mb-3"
        />

        {/* Premium frequency chips */}
        <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
          Premium Frequency
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {FREQ_OPTIONS.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => setPremiumFreq(f.value)}
              className="px-3 py-1.5 rounded-full border"
              style={{
                borderColor: premiumFreq === f.value ? theme.primary : colors.border,
                backgroundColor: premiumFreq === f.value ? theme.primary + "18" : "transparent",
              }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: premiumFreq === f.value ? theme.primary : colors.textSecondary }}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row gap-3 mb-3">
          <DateInput
            label="Start Date"
            value={startDate}
            onChange={setStartDate}
            placeholder="Start date"
            maximumDate={null}
            containerClassName="flex-1"
          />
          <DateInput
            label="Expiry Date"
            value={expiryDate}
            onChange={setExpiryDate}
            placeholder="Expiry date"
            maximumDate={null}
            containerClassName="flex-1"
          />
        </View>

        {/* Family coverage (health only) */}
        {policyType === "health" && (
          <View className="mb-3">
            <Pressable
              className="flex-row items-center gap-2 mb-2"
              onPress={() => setCoversFamily(!coversFamily)}
            >
              <Ionicons
                name={coversFamily ? "checkbox" : "square-outline"}
                size={20}
                color={coversFamily ? theme.primary : colors.textSecondary}
              />
              <Text className="text-sm text-foreground">
                Family floater policy
              </Text>
            </Pressable>
            {coversFamily && (
              <Input
                label="Family Members Covered"
                value={familyMembers}
                onChangeText={setFamilyMembers}
                keyboardType="numeric"
                placeholder="e.g. 4"
                containerClassName="ml-7"
              />
            )}
          </View>
        )}

        <Input
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional details"
          multiline
          numberOfLines={2}
          containerClassName="mb-4"
        />
      </ScrollView>

      {/* Save button */}
      <View className="px-5 pb-2">
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }}
        >
          <Text className="text-sm font-bold text-white">
            {saving ? "Saving…" : isEdit ? "Update Policy" : "Add Policy"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
