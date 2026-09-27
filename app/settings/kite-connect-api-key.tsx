import React, { useState, useEffect } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { BrokerTermsCard } from '@/components/broker/BrokerTermsCard';
import { acceptBrokerTerms, hasAcceptedBrokerTerms } from '@/services/broker-terms';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/hooks/use-alert';
import { logger } from '@/utils/logger';
import {
  getKiteApiKey,
  getKiteApiSecret,
  storeKiteApiKey,
  storeKiteApiSecret,
  clearKiteCredentials,
} from '@/services/kite-connect';
import { BrokerVaultActions } from '@/components/broker/BrokerVaultActions';
import { loadBrokerSecretsFromVault, saveBrokerSecretsToVault } from '@/services/broker-vault';
import { setKiteVaultEntryId } from '@/services/kite-login-autofill';
import { isValidTotpSecret } from '@/utils/totp';

export default function KiteConnectApiKeyScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [agreed, setAgreed] = useState(() => hasAcceptedBrokerTerms('kite'));
  // Optional: lets Arth fill Zerodha's login page when you reconnect each day.
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [totpKey, setTotpKey] = useState('');
  const [showTotpKey, setShowTotpKey] = useState(false);

  useEffect(() => {
    Promise.all([
      getKiteApiKey().then((key) => { if (key) setApiKey(key); }),
      getKiteApiSecret().then((sec) => { if (sec) setApiSecret(sec); }),
      loadBrokerSecretsFromVault('kite').then((v) => {
        if (v?.apiSecret) setApiSecret((cur) => cur || v.apiSecret!);
        if (v?.clientId) setLoginId(v.clientId);
        if (v?.password) setLoginPassword(v.password);
        if (v?.totpSecret) setTotpKey(v.totpSecret);
      }),
    ])
      .catch((e) => logger.error('Error loading Kite credentials:', e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      alert('Error', 'Enter both your Kite API key and API secret.');
      return;
    }
    if (!agreed) return;
    const totp = totpKey.replace(/[\s=]/g, '').toUpperCase();
    if (totp && !isValidTotpSecret(totp)) {
      alert(
        'Invalid TOTP key',
        'Paste the text key Zerodha showed when you set up TOTP (letters A–Z and digits 2–7), not a 6-digit code.',
      );
      return;
    }
    acceptBrokerTerms('kite');
    setIsSaving(true);
    try {
      await storeKiteApiKey(apiKey.trim());
      await storeKiteApiSecret(apiSecret.trim());
      const hasLogin = loginId.trim() || loginPassword.trim() || totp;
      if (hasLogin) {
        const { entryId } = await saveBrokerSecretsToVault('kite', {
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          clientId: loginId.trim().toUpperCase(),
          password: loginPassword,
          totpSecret: totp,
        });
        setKiteVaultEntryId(entryId);
      }
      alert(
        'Saved',
        hasLogin
          ? 'Arth will fill your Zerodha login and TOTP code when you connect.'
          : 'API key and secret saved.',
      );
      router.back();
    } catch (e) {
      logger.error('Failed to save Kite credentials:', e);
      alert('Error', 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    alert(
      'Clear API Key',
      'Are you sure you want to clear the API key and disconnect?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearKiteCredentials();
              setApiKey('');
            } catch (e) {
              logger.error('Failed to clear Kite credentials:', e);
              alert('Error', 'Failed to clear API key');
            }
          },
        },
      ],
    );
  };

  const inputStyle = {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter',
  } as const;

  if (isLoading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View className="mx-4 mt-3">

        {/* Input */}
        <Card className="mb-3">
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            API Key
          </Text>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="e.g. abcdef1234567890"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
          <Text className="text-xs text-muted-foreground mt-2 mb-4">
            Found at developers.kite.trade/apps → your app → API Key
          </Text>
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            API Secret
          </Text>
          <TextInput
            value={apiSecret}
            onChangeText={setApiSecret}
            placeholder="Your app's API secret"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
          <Text className="text-xs text-muted-foreground mt-2">
            Same page, next to the API key. It stays encrypted on this phone; only a one-way checksum made from
            it is sent to Zerodha when you log in.
          </Text>
        </Card>

        {/* Zerodha login — optional, for filling the daily login */}
        <Card className="mb-3">
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Zerodha login (optional)
          </Text>
          <Text className="text-xs text-muted-foreground mb-3">
            Arth fills these on Zerodha’s login page when you connect each day. You still tap Login yourself.
          </Text>
          <TextInput
            value={loginId}
            onChangeText={setLoginId}
            placeholder="User ID, e.g. AB1234"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[inputStyle, { marginBottom: 10 }]}
          />
          <TextInput
            value={loginPassword}
            onChangeText={setLoginPassword}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[inputStyle, { marginBottom: 10 }]}
          />
          <View className="flex-row items-center">
            <TextInput
              value={totpKey}
              onChangeText={setTotpKey}
              placeholder="TOTP key"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
              secureTextEntry={!showTotpKey}
              style={[inputStyle, { flex: 1 }]}
            />
            <Pressable
              onPress={() => setShowTotpKey((v) => !v)}
              hitSlop={8}
              className="ml-3"
              accessibilityLabel={showTotpKey ? 'Hide TOTP key' : 'Show TOTP key'}
            >
              <Ionicons name={showTotpKey ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text className="text-xs text-muted-foreground mt-2">
            The TOTP key is the text code Zerodha shows when you set up TOTP (“Can’t scan the QR code?”). Stored
            encrypted in your Vault.
          </Text>
        </Card>

<BrokerTermsCard broker="kite" agreed={agreed} onAgreedChange={setAgreed} />

        {/* Action buttons */}
        <View className="flex-row gap-3 mb-3">
          <Pressable
            onPress={handleSave}
            disabled={isSaving || !agreed}
            className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
            style={{ backgroundColor: theme.primary, opacity: isSaving || !agreed ? 0.5 : 1 }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text className="text-white font-semibold text-sm ml-2">Save</Text>
              </>
            )}
          </Pressable>

          {apiKey ? (
            <Pressable
              onPress={handleClear}
              className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
              style={{ backgroundColor: theme.danger }}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text className="text-white font-semibold text-sm ml-2">Clear</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.back()}
              className="flex-1 rounded-lg p-3.5 items-center justify-center"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Text className="text-sm font-semibold text-foreground">Cancel</Text>
            </Pressable>
          )}
        </View>

        <BrokerVaultActions
          broker="kite"
          secrets={{ apiKey, apiSecret, clientId: loginId, password: loginPassword, totpSecret: totpKey }}
          onFill={(v) => {
            if (v.apiKey) setApiKey(v.apiKey);
            if (v.apiSecret) setApiSecret(v.apiSecret);
            if (v.clientId) setLoginId(v.clientId);
            if (v.password) setLoginPassword(v.password);
            if (v.totpSecret) setTotpKey(v.totpSecret);
          }}
        />

        {/* Info card */}
        <Card>
          <View className="flex-row items-center mb-2">
            <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
              How to set up your Kite Connect app
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground leading-5">
            1. Go to developers.kite.trade/apps and sign in with your Zerodha account{'\n'}
            2. Create an app (Zerodha may charge for Kite Connect; check their current pricing){'\n'}
            3. Set the Redirect URL to https://127.0.0.1 (any URL works; Arth reads the login result itself){'\n'}
            4. Copy the API Key and API Secret from the app details page into the fields above
          </Text>
        </Card>

      </View>
      </ScrollView>
    </ScreenContainer>
  );
}
