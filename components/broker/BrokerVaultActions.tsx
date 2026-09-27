import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import {
  hasBrokerVaultEntry,
  loadBrokerSecretsFromVault,
  saveBrokerSecretsToVault,
  type BrokerSecrets,
  type VaultBroker,
} from "@/services/broker-vault";
import { logger } from "@/utils/logger";

const NAMES: Record<VaultBroker, string> = { kite: "Kite", angel: "Angel One", zebpay: "ZebPay" };

/**
 * "Save to Vault" / "Fill from Vault" for a broker's credentials screen. Broker secrets aren't in
 * backups (they stay in the phone's secure storage); the Vault is - so this is how they move to a
 * new phone.
 */
export function BrokerVaultActions({
  broker,
  secrets,
  onFill,
}: {
  broker: VaultBroker;
  /** What's in the form now. Save is offered once anything is filled in. */
  secrets: BrokerSecrets;
  onFill: (secrets: BrokerSecrets) => void;
}) {
  const alert = useAlert();
  const [inVault, setInVault] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = NAMES[broker];

  const refresh = useCallback(() => {
    hasBrokerVaultEntry(broker)
      .then(setInVault)
      .catch(() => setInVault(false));
  }, [broker]);
  useEffect(refresh, [refresh]);

  const hasAny = Object.values(secrets).some((v) => (v ?? "").trim());

  const save = async () => {
    setBusy(true);
    try {
      const { created } = await saveBrokerSecretsToVault(broker, secrets);
      setInVault(true);
      alert(
        created ? "Saved to Vault" : "Vault updated",
        `Your ${name} credentials are in the Vault, so they're included in your backups. ` +
          `After restoring on a new phone, tap "Fill from Vault" here.`,
      );
    } catch (e) {
      logger.error(`Failed to save ${broker} credentials to the Vault:`, e);
      alert("Couldn't save to Vault", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    setBusy(true);
    try {
      const s = await loadBrokerSecretsFromVault(broker);
      if (!s || !Object.values(s).some(Boolean)) {
        alert("Nothing to fill", `The Vault has no ${name} credentials yet.`);
        return;
      }
      onFill(s);
    } catch (e) {
      logger.error(`Failed to read ${broker} credentials from the Vault:`, e);
      alert("Couldn't read the Vault", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!hasAny && !inVault) return null;

  return (
    <View className="mb-3">
      <View className="flex-row" style={{ gap: 12 }}>
        {inVault && (
          <Button title="Fill from Vault" variant="secondary" onPress={fill} disabled={busy} className="flex-1 border border-border" />
        )}
        {hasAny && (
          <Button
            title={inVault ? "Update Vault" : "Save to Vault"}
            variant="secondary"
            onPress={save}
            loading={busy}
            className="flex-1 border border-border"
          />
        )}
      </View>
      <Text className="text-xs text-muted-foreground mt-2">
        {"Credentials stay on this phone and aren't in backups. Keep a copy in the Vault (which is backed up) to "}
        reconnect after moving phones.
      </Text>
    </View>
  );
}
