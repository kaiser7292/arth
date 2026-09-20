import React, { useState, useEffect } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View, Pressable, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/hooks/use-alert';
import { logger } from '@/utils/logger';
import {
  connectZebpay,
  getZebpayCredentials,
  clearZebpayCredentials,
} from '@/services/zebpay-connect';

export default function ZebpayConnectCredentialsScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [apiKey, setApiKey]       = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy]       = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    getZebpayCredentials()
      .then(creds => {
        if (creds) {
          setApiKey(creds.apiKey);
          setSecretKey(creds.secretKey);
          setHasExisting(true);
        }
      })
      .catch(e => logger.error('Failed to load Zebpay credentials:', e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleConnect = async () => {
    if (!apiKey.trim() || !secretKey.trim()) {
      alert('Missing Fields', 'Enter both API Key and Secret Key.');
      return;
    }
    setIsBusy(true);
    try {
      await connectZebpay(apiKey.trim(), secretKey.trim());
      alert('Connected', 'Zebpay account connected successfully.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Connection Failed', msg || 'Could not connect. Check your API key and secret.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleClear = () => {
    alert(
      'Remove Credentials',
      'This will disconnect your Zebpay account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearZebpayCredentials();
              setApiKey(''); setSecretKey(''); setHasExisting(false);
              router.back();
            } catch (e) {
              logger.error('Failed to clear Zebpay credentials:', e);
              alert('Error', 'Failed to remove credentials.');
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
      <ScreenContainer>
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

          <Card className="mb-3">
            <View className="mb-4">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                API Key
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Your Zebpay API key"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
            </View>
            <View>
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Secret Key
              </Text>
              <TextInput
                value={secretKey}
                onChangeText={setSecretKey}
                placeholder="Your Zebpay secret key"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={inputStyle}
              />
            </View>
          </Card>

          <View className="flex-row gap-3 mb-3">
            <Pressable
              onPress={handleConnect}
              disabled={isBusy}
              className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
              style={{ backgroundColor: theme.primary, opacity: isBusy ? 0.7 : 1 }}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="link-outline" size={18} color="#fff" />
                  <Text className="text-white font-semibold text-sm ml-2">
                    {hasExisting ? 'Update & Reconnect' : 'Connect'}
                  </Text>
                </>
              )}
            </Pressable>

            {hasExisting ? (
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

          <Card>
            <View className="flex-row items-center mb-2">
              <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
              <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
                How to get API credentials
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5 mb-3">
              {'1. Go to build.zebpay.com and sign in with your Zebpay account\n'}
              {'2. Create a new app — you will get an API Key and Secret Key\n'}
              {'3. Copy both here and tap Connect\n\n'}
              {'No OTP or PIN is needed — the API key identifies you directly.'}
            </Text>
            <Pressable
              onPress={() => Linking.openURL('https://build.zebpay.com').catch(() => {})}
              className="flex-row items-center"
            >
              <Ionicons name="open-outline" size={14} color={theme.primary} />
              <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>
                Open build.zebpay.com
              </Text>
            </Pressable>
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
