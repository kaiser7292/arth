import * as SecureStore from 'expo-secure-store';

const KITE_API_KEY = 'kite_api_key';
const KITE_ACCESS_TOKEN = 'kite_access_token';
const KITE_USER_ID = 'kite_user_id';
const KITE_PUBLIC_TOKEN = 'kite_public_token';
const BACKEND_URL = process.env.EXPO_PUBLIC_KITE_BACKEND_URL ?? ''; // Set EXPO_PUBLIC_KITE_BACKEND_URL in your .env file

export interface KiteCredentials {
  apiKey: string;
  accessToken?: string;
  userId?: string;
  publicToken?: string;
}

export interface KiteOAuthResponse {
  access_token: string;
  user_id: string;
  public_token: string;
}

/**
 * Store Kite API key
 */
export async function storeKiteApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(KITE_API_KEY, apiKey);
}

/**
 * Get Kite API key
 */
export async function getKiteApiKey(): Promise<string | null> {
  return await SecureStore.getItemAsync(KITE_API_KEY);
}

/**
 * Store Kite access token
 */
export async function storeKiteAccessToken(credentials: KiteOAuthResponse): Promise<void> {
  await SecureStore.setItemAsync(KITE_ACCESS_TOKEN, credentials.access_token);
  await SecureStore.setItemAsync(KITE_USER_ID, credentials.user_id);
  await SecureStore.setItemAsync(KITE_PUBLIC_TOKEN, credentials.public_token);
}

/**
 * Get Kite credentials
 */
export async function getKiteCredentials(): Promise<KiteCredentials | null> {
  const apiKey = await getKiteApiKey();
  if (!apiKey) return null;

  const accessToken = await SecureStore.getItemAsync(KITE_ACCESS_TOKEN);
  const userId = await SecureStore.getItemAsync(KITE_USER_ID);
  const publicToken = await SecureStore.getItemAsync(KITE_PUBLIC_TOKEN);

  return {
    apiKey,
    accessToken: accessToken || undefined,
    userId: userId || undefined,
    publicToken: publicToken || undefined,
  };
}

/**
 * Clear Kite credentials
 */
export async function clearKiteCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KITE_API_KEY);
  await SecureStore.deleteItemAsync(KITE_ACCESS_TOKEN);
  await SecureStore.deleteItemAsync(KITE_USER_ID);
  await SecureStore.deleteItemAsync(KITE_PUBLIC_TOKEN);
}

/**
 * Exchange request_token for access_token via backend
 */
export async function exchangeRequestToken(requestToken: string): Promise<KiteOAuthResponse> {
  const response = await fetch(`${BACKEND_URL}/api/kite/exchange-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ request_token: requestToken }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to exchange token');
  }

  return await response.json();
}

/**
 * Check if user is authenticated with Kite
 */
export async function isKiteAuthenticated(): Promise<boolean> {
  const credentials = await getKiteCredentials();
  return !!(credentials?.apiKey && credentials?.accessToken);
}

/**
 * Generate Kite login URL
 */
export function getKiteLoginUrl(apiKey: string): string {
  return `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3`;
}
