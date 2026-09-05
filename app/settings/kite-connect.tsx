import { Card, ScreenContainer, Text } from "@/components/ui";
import { StatusColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlert } from '@/hooks/use-alert';
import {
    clearKiteCredentials,
    exchangeRequestToken,
    getKiteCredentials,
    getKiteLoginUrl,
    isKiteAuthenticated,
    storeKiteAccessToken
} from '@/services/kite-connect';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from "react-native";
import { WebView } from 'react-native-webview';

export default function KiteConnectScreen() {
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showWebView, setShowWebView] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const auth = await isKiteAuthenticated();
      setIsAuthenticated(auth);
    } catch (error) {
      console.error('Error checking auth status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectPress = async () => {
    try {
      const credentials = await getKiteCredentials();
      if (!credentials?.apiKey) {
        alert(
          'API Key Required',
          'Please enter your Kite API key first. You can get it from https://developers.kite.trade/apps',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Enter API Key',
              onPress: () => router.push('/settings/kite-connect-api-key' as any),
            },
          ]
        );
        return;
      }

      const url = getKiteLoginUrl(credentials.apiKey);
      setLoginUrl(url);
      setShowWebView(true);
    } catch (error) {
      alert('Error', 'Failed to initiate Kite login');
    }
  };

  const handleDisconnectPress = () => {
    alert(
      'Disconnect Kite',
      'Are you sure you want to disconnect from Kite? This will clear your credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearKiteCredentials();
              setIsAuthenticated(false);
              alert('Success', 'Disconnected from Kite');
            } catch (error) {
              alert('Error', 'Failed to disconnect');
            }
          },
        },
      ]
    );
  };

  const handleWebViewNavigationStateChange = async (navState: any) => {
    const url = navState.url;

    // Check if URL contains request_token (Kite redirects to the registered URL with this parameter)
    if (url.includes('request_token=')) {
      setShowWebView(false);

      // Extract request_token from URL
      const urlObj = Linking.parse(url);
      const requestToken = urlObj.queryParams?.request_token as string;
      const status = urlObj.queryParams?.status as string;

      if (requestToken) {
        try {
          setIsLoading(true);
          const credentials = await exchangeRequestToken(requestToken);
          await storeKiteAccessToken(credentials);
          setIsAuthenticated(true);
          alert('Success', 'Successfully connected to Kite!');
        } catch (error) {
          alert('Error', 'Failed to complete authentication');
          console.error('Token exchange error:', error);
        } finally {
          setIsLoading(false);
        }
      } else {
        alert('Error', 'Authentication failed or was cancelled');
      }
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.textSecondary} />
        </View>
      </ScreenContainer>
    );
  }

  if (showWebView) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        <WebView
          ref={webViewRef}
          source={{ uri: loginUrl }}
          onNavigationStateChange={handleWebViewNavigationStateChange}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
        />
      </View>
    );
  }

  return (
    <ScreenContainer>
      <View className="mx-4 mt-3">
        <Card>
          <Text className="text-xl font-bold" style={{ color: colors.text }}>
            Kite Connect
          </Text>
          <Text className="text-sm mt-1" style={{ color: colors.textSecondary }}>
            Connect your Zerodha Kite account to access portfolio data and trading features.
          </Text>

          {isAuthenticated ? (
            <View className="rounded-lg p-4 mt-4" style={{ backgroundColor: sc.success + '20', borderColor: sc.success, borderWidth: 1 }}>
              <View className="flex-row items-center mb-2">
                <Ionicons name="checkmark-circle" size={20} color={sc.success} />
                <Text className="ml-2 font-semibold" style={{ color: sc.success }}>
                  Connected to Kite
                </Text>
              </View>
              <Text className="text-sm" style={{ color: sc.success }}>
                Your Kite account is linked and ready to use.
              </Text>
            </View>
          ) : (
            <View className="rounded-lg p-4 mt-4" style={{ backgroundColor: sc.warning + '20', borderColor: sc.warning, borderWidth: 1 }}>
              <View className="flex-row items-center mb-2">
                <Ionicons name="alert-circle" size={20} color={sc.warning} />
                <Text className="ml-2 font-semibold" style={{ color: sc.warning }}>
                  Not Connected
                </Text>
              </View>
              <Text className="text-sm" style={{ color: sc.warning }}>
                Connect to Kite to enable portfolio tracking and trading features.
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleConnectPress}
            className="rounded-lg p-4 mt-4 flex-row items-center justify-between"
            style={{ backgroundColor: colors.tint }}
          >
            <Text className="text-white font-semibold text-base">
              {isAuthenticated ? 'Reconnect to Kite' : 'Connect to Kite'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="white" />
          </Pressable>

          {isAuthenticated && (
            <Pressable
              onPress={handleDisconnectPress}
              className="rounded-lg p-4 mt-3 flex-row items-center justify-center"
              style={{ backgroundColor: sc.danger }}
            >
              <View className="flex-row items-center">
                <Ionicons name="log-out" size={20} color="white" />
                <Text className="text-white font-semibold text-base ml-2">
                  Disconnect
                </Text>
              </View>
            </Pressable>
          )}

          <View className="mt-6 p-4 rounded-lg" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xs font-semibold mb-2" style={{ color: colors.textSecondary }}>
              How to connect:
            </Text>
            <Text className="text-xs mb-1" style={{ color: colors.textSecondary }}>
              1. Get API key from developers.kite.trade
            </Text>
            <Text className="text-xs mb-1" style={{ color: colors.textSecondary }}>
              2. Enter API key in settings
            </Text>
            <Text className="text-xs" style={{ color: colors.textSecondary }}>
              3. Login through Kite to authorize
            </Text>
          </View>
        </Card>
      </View>
    </ScreenContainer>
  );
}
