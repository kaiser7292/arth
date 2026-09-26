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
import { connectAngel, getAngelCredentials, clearAngelCredentials } from '@/services/angel-connect';
import { createVaultEntry, searchVaultEntries } from '@/services/vault';

function CredentialField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  secure,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  secure?: boolean;
  colors: ReturnType<typeof useColorScheme>['colors'];
}) {
  return (
    <View className="mb-4">
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        style={{
          color: colors.text,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          fontFamily: 'Inter',
        }}
      />
      {hint && <Text className="text-xs text-muted-foreground mt-1.5">{hint}</Text>}
    </View>
  );
}

export default function AngelConnectCredentialsScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [password, setPassword] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [agreed, setAgreed] = useState(() => hasAcceptedBrokerTerms('angel'));

  useEffect(() => {
    getAngelCredentials()
      .then(creds => {
        if (creds) {
          setApiKey(creds.apiKey);
          setClientId(creds.clientId);
          setPassword(creds.password);
          setTotpSecret(creds.totpSecret);
        }
      })
      .catch(e => logger.error('Error loading Angel credentials:', e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleConnect = async () => {
    if (!apiKey.trim() || !clientId.trim() || !password.trim() || !totpSecret.trim()) {
      alert('Missing Fields', 'Please fill in all four fields before connecting.');
      return;
    }
    if (!agreed) return;
    acceptBrokerTerms('angel');
    setIsSaving(true);
    try {
      await connectAngel(apiKey.trim(), clientId.trim(), password.trim(), totpSecret.trim());
      alert('Connected', 'Angel One account connected successfully.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Connection Failed', msg || 'Could not connect to Angel One. Check your credentials and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveToVault = async () => {
    if (!apiKey.trim()) {
      alert('Not Connected', 'Connect first, then save to Vault.');
      return;
    }
    try {
      const existing = await searchVaultEntries('Angel One SmartAPI');
      if (existing.length > 0) {
        alert('Already in Vault', 'An "Angel One SmartAPI" entry already exists in your Vault.');
        return;
      }
      await createVaultEntry({
        title: 'Angel One SmartAPI',
        category: 'demat',
        login_method: 'password',
        username: clientId.trim() || undefined,
        password: password.trim() || undefined,
        url: 'https://smartapi.angelone.in',
        notes: 'Angel One SmartAPI credentials used by Arth for portfolio sync',
        custom_fields_data: {
          'API Key': apiKey.trim(),
          'TOTP Secret': totpSecret.trim(),
        },
      });
      alert('Saved to Vault', 'Your Angel One credentials have been added to your Vault.');
    } catch (e) {
      logger.error('Failed to save Angel creds to vault:', e);
      alert('Error', 'Could not save to Vault. Please try again.');
    }
  };

  const handleClear = () => {
    alert(
      'Remove Credentials',
      'This will disconnect your Angel One account and remove all stored credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAngelCredentials();
              setApiKey(''); setClientId(''); setPassword(''); setTotpSecret('');
              router.back();
            } catch (e) {
              logger.error('Failed to clear Angel credentials:', e);
              alert('Error', 'Failed to remove credentials.');
            }
          },
        },
      ],
    );
  };

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
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mx-4 mt-3">

          {/* Credentials */}
          <Card className="mb-3">
            <CredentialField
              label="API Key"
              value={apiKey}
              onChange={setApiKey}
              placeholder="e.g. abc123XYZ"
              hint="From smartapi.angelone.in → Apps → your app"
              colors={colors}
            />
            <CredentialField
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              placeholder="Your Angel One login ID"
              hint="Same ID you use to log in to Angel One"
              colors={colors}
            />
            <CredentialField
              label="Password / MPIN"
              value={password}
              onChange={setPassword}
              placeholder="Your login password"
              secure
              colors={colors}
            />
            <CredentialField
              label="TOTP Secret"
              value={totpSecret}
              onChange={setTotpSecret}
              placeholder="32-character base32 secret"
              hint="Setup → Enable TOTP in Angel One app → copy the secret key shown (not the QR code)"
              secure
              colors={colors}
            />
          </Card>

<BrokerTermsCard broker="angel" agreed={agreed} onAgreedChange={setAgreed} />

          {/* Action buttons */}
          <View className="flex-row gap-3 mb-3">
            <Pressable
              onPress={handleConnect}
              disabled={isSaving || !agreed}
              className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
              style={{ backgroundColor: theme.primary, opacity: isSaving || !agreed ? 0.5 : 1 }}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="link-outline" size={18} color="#fff" />
                  <Text className="text-white font-semibold text-sm ml-2">Connect</Text>
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
                <Text className="text-white font-semibold text-sm ml-2">Remove</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.back()}
                className="flex-1 rounded-lg p-3.5 items-center justify-center border border-border"
                style={{ backgroundColor: colors.surface }}
              >
                <Text className="text-sm font-semibold text-foreground">Cancel</Text>
              </Pressable>
            )}
          </View>

          {/* Save to Vault */}
          {apiKey ? (
            <Pressable
              onPress={handleSaveToVault}
              className="flex-row items-center justify-center mb-3 py-3 rounded-lg border border-border"
              style={{ backgroundColor: colors.surface }}
            >
              <Ionicons name="lock-closed-outline" size={16} color={colors.text} />
              <Text className="text-sm font-semibold text-foreground ml-2">Save to Vault</Text>
            </Pressable>
          ) : null}

          {/* How to get credentials */}
          <Card>
            <View className="flex-row items-center mb-2">
              <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
              <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
                How to set up SmartAPI
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5">
              {'1. Go to smartapi.angelone.in and create an app\n'}
              {'2. Copy the API Key from the app details page\n'}
              {'3. Your Client ID is your Angel One login ID\n'}
              {'4. In the Angel One app → Profile → Enable TOTP\n'}
              {'5. During TOTP setup, tap "Can\'t scan?" to reveal the secret key\n'}
              {'   Copy that 32-character string — that is your TOTP Secret'}
            </Text>
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
