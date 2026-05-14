import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getKiteApiKey,
  storeKiteApiKey,
  clearKiteCredentials,
} from '@/services/kite-connect';
import { logger } from '@/utils/logger';

export default function KiteConnectApiKeyScreen() {
  const alert = useAlert();
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadApiKey();
  }, []);

  const loadApiKey = async () => {
    try {
      const key = await getKiteApiKey();
      if (key) {
        setApiKey(key);
      }
    } catch (error) {
      logger.error('Error loading Kite API key:', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

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
    } catch (error) {
      alert('Error', 'Failed to save API key');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    alert(
      'Clear API Key',
      'Are you sure you want to clear the API key?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearKiteCredentials();
              setApiKey('');
              alert('Success', 'API key cleared');
            } catch (e) {
              logger.error('Failed to clear Kite credentials:', e);
              alert('Error', 'Failed to clear API key');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background-light dark:bg-background-dark">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-background-light dark:bg-background-dark p-4">
        <Text className="text-red-500 text-base text-center">Failed to load API key. Please restart the app.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark p-4">
      <Text className="text-2xl font-bold text-text-light dark:text-text-dark mb-2">
        Kite API Key
      </Text>
      <Text className="text-sm text-secondary-light dark:text-secondary-dark mb-6">
        Enter your Kite API key from the developer portal. Keep this secure.
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-medium text-text-light dark:text-text-dark mb-2">
          API Key
        </Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Enter your API key"
          className="border border-border-light dark:border-border-dark rounded-lg p-3 text-text-light dark:text-text-dark bg-background-light dark:bg-background-dark"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>

      <View className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <Text className="text-xs text-blue-700 dark:text-blue-400 mb-2 font-semibold">
          Where to get your API key:
        </Text>
        <Text className="text-xs text-blue-600 dark:text-blue-500 mb-1">
          1. Visit https://developers.kite.trade/apps
        </Text>
        <Text className="text-xs text-blue-600 dark:text-blue-500 mb-1">
          2. Create a new app or select existing
        </Text>
        <Text className="text-xs text-blue-600 dark:text-blue-500">
          3. Copy the API key from the app details
        </Text>
      </View>

      <View className="flex-row gap-3">
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          className="flex-1 bg-primary rounded-lg p-4 flex-row items-center justify-center"
        >
          {isSaving ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="white" />
              <Text className="text-white font-semibold text-base ml-2">
                Save
              </Text>
            </>
          )}
        </Pressable>

        {apiKey ? (
          <Pressable
            onPress={handleClear}
            className="flex-1 bg-red-500 rounded-lg p-4 flex-row items-center justify-center"
          >
            <Ionicons name="close" size={20} color="white" />
            <Text className="text-white font-semibold text-base ml-2">
              Clear
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.back()}
            className="flex-1 bg-gray-500 rounded-lg p-4 items-center justify-center"
          >
            <Text className="text-white font-semibold text-base">
              Cancel
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
