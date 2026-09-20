import React, { useState, useEffect } from 'react';
import { ActivityIndicator, TextInput, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/hooks/use-alert';
import { logger } from '@/utils/logger';
import {
  getKiteApiKey,
  storeKiteApiKey,
  clearKiteCredentials,
} from '@/services/kite-connect';

export default function KiteConnectApiKeyScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getKiteApiKey()
      .then((key) => { if (key) setApiKey(key); })
      .catch((e) => logger.error('Error loading Kite API key:', e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      alert('Error', 'Please enter your API key');
      return;
    }
    setIsSaving(true);
    try {
      await storeKiteApiKey(apiKey.trim());
      alert('Success', 'API key saved successfully');
      router.back();
    } catch {
      alert('Error', 'Failed to save API key');
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
          <Text className="text-xs text-muted-foreground mt-2">
            Found at developers.kite.trade/apps → your app → API Key
          </Text>
        </Card>

        {/* Action buttons */}
        <View className="flex-row gap-3 mb-3">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
            style={{ backgroundColor: theme.primary, opacity: isSaving ? 0.7 : 1 }}
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

        {/* Save to Vault */}
        {apiKey ? (
          <Pressable
            onPress={() => {
              alert('Coming Soon', 'Password Vault is not available yet. Your API key is already saved securely in encrypted storage on this device.');
            }}
            className="flex-row items-center mb-3 rounded-lg p-3.5"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Ionicons name="lock-closed-outline" size={16} color={theme.primary} />
            <Text className="text-sm font-semibold ml-2" style={{ color: theme.primary }}>
              Save to Vault
            </Text>
            <View className="ml-auto rounded px-1.5 py-0.5" style={{ backgroundColor: theme.alpha('primary', 0.1) }}>
              <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Soon</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Info card */}
        <Card>
          <View className="flex-row items-center mb-2">
            <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
              How to get your API key
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground leading-5">
            1. Go to developers.kite.trade/apps{'\n'}
            2. Open your app (or create one){'\n'}
            3. Copy the API Key from the app details page
          </Text>
        </Card>

      </View>
    </ScreenContainer>
  );
}
