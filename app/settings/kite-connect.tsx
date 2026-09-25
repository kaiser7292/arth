import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlert } from '@/hooks/use-alert';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/utils/format';
import { generateTOTP, totpSecondsRemaining } from '@/utils/totp';
import {
  KITE_LOGIN_WATCHER_JS,
  buildLoginFillJs,
  buildTotpFillJs,
  getKiteLoginCandidates,
  getKiteLoginSecrets,
  getKiteVaultEntryId,
  isKiteLoginUrl,
  setKiteVaultEntryId,
} from '@/services/kite-login-autofill';
import { getVaultEntry, type VaultEntry } from '@/services/vault';
import {
  kiteHoldingRow,
  kiteMFOrderRow,
  kiteMFRow,
  kiteOrderRow,
  kitePositionRow,
  kiteSipRow,
} from '@/services/portfolio-rows';
import {
  PortfolioNoMatches,
  PortfolioSearchSort,
  PortfolioSection,
  PortfolioSummary,
  usePortfolioView,
} from '@/components/portfolio/PortfolioList';
import { saveBrokerSnapshot } from '@/services/financial-account';
import {
  clearKiteCredentials,
  clearKiteSession,
  exchangeRequestToken,
  getCachedHoldings,
  getCachedMFHoldings,
  getCachedMFOrders,
  getCachedOrders,
  getCachedPositions,
  getCachedSIPs,
  getCachedTotals,
  getDematAccountsForPicker,
  getKiteCredentials,
  getKiteLoginUrl,
  getLastSynced,
  getLinkedAccountId,
  isKiteAuthenticated,
  isKiteTokenExpired,
  setLinkedAccountId,
  storeKiteAccessToken,
  syncKiteData,
  type KiteHolding,
  type KiteMFHolding,
  type KiteOrder,
  type KiteMFOrder,
  type KitePosition,
  type KiteSIP,
} from '@/services/kite-connect';

export default function KiteConnectScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  // Auth state
  const [isLoading, setIsLoading]           = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tokenExpired, setTokenExpired]       = useState(false);
  const [showWebView, setShowWebView]         = useState(false);
  const [loginUrl, setLoginUrl]               = useState('');
  const webViewRef = useRef<WebView>(null);

  // Vault-backed login fill
  const [vaultEntry, setVaultEntry]             = useState<VaultEntry | null>(null);
  const [vaultCandidates, setVaultCandidates]   = useState<VaultEntry[]>([]);
  const [showVaultPicker, setShowVaultPicker]   = useState(false);
  const [loginTotpSecret, setLoginTotpSecret]   = useState<string | null>(null);
  const [totpNow, setTotpNow]                   = useState(Date.now());

  // Linked account
  const [linkedAccountId, setLinkedAccountIdState] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker]  = useState(false);
  const [pickerAccounts, setPickerAccounts]         = useState<{ id: string; label: string }[]>([]);

  // Sync state
  const [syncing, setSyncing]               = useState(false);
  const [savingSnapshot, setSavingSnapshot]   = useState(false);
  const [lastSynced, setLastSynced]           = useState<string | null>(null);
  const [holdings, setHoldings]               = useState<KiteHolding[]>([]);
  const [mfHoldings, setMFHoldings]           = useState<KiteMFHolding[]>([]);
  const [positions, setPositions]             = useState<KitePosition[]>([]);
  const [sips, setSIPs]                       = useState<KiteSIP[]>([]);
  const [orders, setOrders]                   = useState<KiteOrder[]>([]);
  const [mfOrders, setMFOrders]               = useState<KiteMFOrder[]>([]);
  const [portfolioTotal, setPortfolioTotal]   = useState(0);
  const [equityTotal, setEquityTotal]         = useState(0);
  const [mfTotal, setMFTotal]                 = useState(0);
  const [fundsAvailable, setFundsAvailable]   = useState(0);
  const [hasCachedData, setHasCachedData]     = useState(false);
  const { query, setQuery, sort, changeSort, view } = usePortfolioView('kite');

  const load = useCallback(async () => {
    try {
      const entryId = getKiteVaultEntryId();
      setVaultEntry(entryId ? await getVaultEntry(entryId) : null);
      const auth = await isKiteAuthenticated();
      setIsAuthenticated(auth);
      if (auth) {
        setTokenExpired(isKiteTokenExpired());
        setLinkedAccountIdState(getLinkedAccountId());
        const ls = getLastSynced();
        setLastSynced(ls);
        if (ls) {
          const cached   = getCachedHoldings();
          const cachedMF = getCachedMFHoldings();
          const totals   = getCachedTotals();
          setHoldings(cached);
          setMFHoldings(cachedMF);
          setPositions(getCachedPositions());
          setSIPs(getCachedSIPs());
          setOrders(getCachedOrders());
          setMFOrders(getCachedMFOrders());
          setPortfolioTotal(totals.portfolio);
          setEquityTotal(cached.reduce((s, h) => s + (h.quantity + (h.t1_quantity ?? 0)) * h.last_price, 0));
          setMFTotal(cachedMF.reduce((s, h) => s + h.quantity * h.last_price, 0));
          setFundsAvailable(totals.funds);
          setHasCachedData(cached.length > 0 || cachedMF.length > 0);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Connect / reconnect ──────────────────────────────────────────────────

  const handleConnectPress = async () => {
    try {
      const credentials = await getKiteCredentials();
      if (!credentials?.apiKey) {
        alert(
          'API Key Required',
          'Enter your Kite API key first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enter API Key', onPress: () => router.push('/settings/kite-connect-api-key' as any) },
          ],
        );
        return;
      }
      const secrets = vaultEntry ? await getKiteLoginSecrets(vaultEntry.id) : null;
      setLoginTotpSecret(secrets?.totpSecret ?? null);
      setLoginUrl(getKiteLoginUrl(credentials.apiKey));
      setShowWebView(true);
    } catch {
      alert('Error', 'Failed to initiate Kite login');
    }
  };

  // ── Vault login entry ────────────────────────────────────────────────────

  const handleChooseVaultEntry = async () => {
    const candidates = await getKiteLoginCandidates();
    if (candidates.length === 0) {
      alert(
        'No login saved in Vault',
        'Add a Vault entry with your Zerodha user ID, password and TOTP secret first.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add to Vault',
            onPress: () => router.push({
              pathname: '/vault/add',
              params: { prefill_category: 'demat', prefill_title: 'Zerodha' },
            } as any),
          },
        ],
      );
      return;
    }
    setVaultCandidates(candidates);
    setShowVaultPicker(true);
  };

  const handlePickVaultEntry = (entry: VaultEntry | null) => {
    setKiteVaultEntryId(entry?.id ?? null);
    setVaultEntry(entry);
    setShowVaultPicker(false);
  };

  // ── Login window fill ────────────────────────────────────────────────────

  useEffect(() => {
    if (!showWebView || !loginTotpSecret) return;
    const id = setInterval(() => setTotpNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showWebView, loginTotpSecret]);

  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    if (!vaultEntry || !isKiteLoginUrl(event.nativeEvent.url)) return;
    let msg: { arth?: string; type?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.arth !== 'kite-login') return;

    const secrets = await getKiteLoginSecrets(vaultEntry.id);
    if (!secrets) return;

    if (msg.type === 'login_form') {
      webViewRef.current?.injectJavaScript(buildLoginFillJs(secrets.userId, secrets.password));
    } else if (msg.type === 'totp_form' && secrets.totpSecret) {
      // A code about to roll over would likely be rejected; wait for the next one.
      const secsLeft = totpSecondsRemaining();
      const delayMs = secsLeft <= 3 ? secsLeft * 1000 + 300 : 0;
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(buildTotpFillJs(generateTOTP(secrets.totpSecret!)));
      }, delayMs);
    }
  };

  const handleDisconnect = () => {
    alert(
      'Disconnect Kite',
      'This will clear all Kite credentials and cached data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearKiteSession();
            setIsAuthenticated(false);
            setTokenExpired(false);
            setLinkedAccountIdState(null);
            setHoldings([]);
            setMFHoldings([]);
            setPositions([]);
            setSIPs([]);
            setOrders([]);
            setMFOrders([]);
            setPortfolioTotal(0);
            setEquityTotal(0);
            setMFTotal(0);
            setFundsAvailable(0);
            setLastSynced(null);
            setHasCachedData(false);
          },
        },
      ],
    );
  };

  // ── WebView OAuth ────────────────────────────────────────────────────────

  const handleWebViewNavChange = async (navState: any) => {
    const url = navState.url;
    if (!url.includes('request_token=')) return;

    setShowWebView(false);
    setLoginTotpSecret(null);
    const parsed = Linking.parse(url);
    const requestToken = parsed.queryParams?.request_token as string;
    if (!requestToken) {
      alert('Error', 'Authentication failed or was cancelled');
      return;
    }

    let connected = false;
    try {
      setIsLoading(true);
      const credentials = await exchangeRequestToken(requestToken);
      await storeKiteAccessToken(credentials);
      setIsAuthenticated(true);
      setTokenExpired(false);
      connected = true;
    } catch (err: any) {
      alert('Could not connect to Kite', err?.message || 'Failed to complete authentication');
    } finally {
      setIsLoading(false);
    }
    if (connected) await handleSync();
  };

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncKiteData();

      // If no account was auto-linked, show the picker
      if (!result.linkedAccountId) {
        const accounts = await getDematAccountsForPicker();
        setPickerAccounts(accounts);
        setShowAccountPicker(true);
        setSyncing(false);
        return;
      }

      setLinkedAccountIdState(result.linkedAccountId);
      setHoldings(result.holdings);
      setMFHoldings(result.mfHoldings);
      setPositions(result.positions);
      setSIPs(result.sips);
      setOrders(result.orders);
      setMFOrders(result.mfOrders);
      setPortfolioTotal(result.portfolioTotal);
      setEquityTotal(result.equityTotal);
      setMFTotal(result.mfTotal);
      setFundsAvailable(result.fundsAvailable);
      setLastSynced(result.syncedAt);
      setHasCachedData(true);
    } catch (err: any) {
      const msg: string = err.message ?? '';
      const isAuthError = msg === 'TOKEN_EXPIRED'
        || msg.toLowerCase().includes('access token')
        || msg.toLowerCase().includes('api key')
        || msg.toLowerCase().includes('invalid token')
        || msg.toLowerCase().includes('token expired');

      if (isAuthError) {
        setTokenExpired(true);
        alert('Session Expired', 'Your Kite session has expired. Tap "Reconnect" to log in again.');
      } else if (msg === 'NO_ACCOUNT_LINKED') {
        const accounts = await getDematAccountsForPicker();
        setPickerAccounts(accounts);
        setShowAccountPicker(true);
      } else {
        alert('Sync Failed', msg || 'Could not fetch data from Kite');
      }
    } finally {
      setSyncing(false);
    }
  };

  // ── Update snapshot ──────────────────────────────────────────────────────

  const handleUpdateSnapshot = async () => {
    if (!linkedAccountId) {
      alert('No Account Linked', 'Link a demat account first by tapping Sync Now.');
      return;
    }
    setSavingSnapshot(true);
    try {
      // Portfolio and funds are always saved together; funds of 0 are saved as 0.
      const saved = await saveBrokerSnapshot(linkedAccountId, portfolioTotal, fundsAvailable);
      alert('Snapshot Saved', `Portfolio ${formatAmount(saved.portfolio)} and funds ${formatAmount(saved.fund)} saved for today.`);
    } catch (err: any) {
      alert('Error', err.message || 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  };

  // ── Account picker ────────────────────────────────────────────────────────

  const handlePickAccount = async (id: string) => {
    setLinkedAccountId(id);
    setLinkedAccountIdState(id);
    setShowAccountPicker(false);
    // Re-run sync now that we have an account
    await handleSync();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatSyncTime = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Today ${time}` : `${d.toLocaleDateString('en-IN')} ${time}`;
  };

  // ── WebView view ──────────────────────────────────────────────────────────

  if (showWebView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {loginTotpSecret && (() => {
          const code = generateTOTP(loginTotpSecret, totpNow);
          const secsLeft = totpSecondsRemaining(totpNow);
          return (
            <View
              className="flex-row items-center px-4 py-2.5"
              style={{ backgroundColor: theme.alpha('primary', 0.1), borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <Ionicons name="lock-closed-outline" size={14} color={theme.primary} />
              <Text className="text-xs text-muted-foreground ml-2">TOTP from Vault</Text>
              <Text className="text-base font-bold text-foreground font-mono tracking-widest ml-3 flex-1">
                {code.slice(0, 3)} {code.slice(3)}
              </Text>
              <Text
                className="text-xs mr-3"
                style={{ color: secsLeft <= 5 ? theme.danger : colors.textSecondary, fontVariant: ['tabular-nums'] }}
              >
                {secsLeft}s
              </Text>
              <Pressable onPress={() => Clipboard.setStringAsync(code)} hitSlop={8}>
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Copy</Text>
              </Pressable>
            </View>
          );
        })()}
        <WebView
          ref={webViewRef}
          source={{ uri: loginUrl }}
          onNavigationStateChange={handleWebViewNavChange}
          injectedJavaScript={vaultEntry ? KITE_LOGIN_WATCHER_JS : undefined}
          onMessage={handleWebViewMessage}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
        />
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  const isConnected = isAuthenticated && !tokenExpired;

  const stockRows = view(holdings.map(kiteHoldingRow));
  const mfRows = view(mfHoldings.map(kiteMFRow));
  const positionRows = view(positions.map(kitePositionRow));
  const sipRows = view(sips.map(kiteSipRow));
  const orderRows = view(orders.map(kiteOrderRow), false);
  const mfOrderRows = view(mfOrders.map(kiteMFOrderRow), false);
  const allRowCount = holdings.length + mfHoldings.length + positions.length + sips.length + orders.length + mfOrders.length;
  const visibleRowCount = stockRows.length + mfRows.length + positionRows.length + sipRows.length + orderRows.length + mfOrderRows.length;
  const investedTotal =
    holdings.reduce((sum, h) => sum + (h.quantity + (h.t1_quantity ?? 0)) * h.average_price, 0) +
    mfHoldings.reduce((sum, h) => sum + h.quantity * h.average_price, 0);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Status card ── */}
        <Card className="mx-4 mt-3 mb-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View
                className="w-2 h-2 rounded-full mr-2"
                style={{
                  backgroundColor: isConnected
                    ? theme.success
                    : tokenExpired
                    ? theme.warning
                    : colors.textSecondary,
                }}
              />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">
                  {!isAuthenticated ? 'Not connected' : tokenExpired ? 'Session Expired' : 'Connected'}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {!isAuthenticated
                    ? 'Tap Connect to link your Kite account'
                    : tokenExpired
                    ? 'Session expired — tap Reconnect'
                    : lastSynced
                    ? `Last synced ${formatSyncTime(lastSynced)}`
                    : 'Not yet synced'}
                </Text>
              </View>
            </View>
            {!isAuthenticated ? (
              <Pressable
                onPress={handleConnectPress}
                className="flex-row items-center px-3 py-2 rounded-lg"
                style={{ backgroundColor: theme.primary }}
              >
                <Ionicons name="link-outline" size={16} color="#fff" />
                <Text className="text-white text-xs font-semibold ml-1">Connect</Text>
              </Pressable>
            ) : tokenExpired ? (
              <Pressable
                onPress={handleConnectPress}
                className="flex-row items-center px-3 py-2 rounded-lg"
                style={{ backgroundColor: theme.warning }}
              >
                <Ionicons name="refresh-outline" size={16} color="#fff" />
                <Text className="text-white text-xs font-semibold ml-1">Reconnect</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSync}
                disabled={syncing}
                className="flex-row items-center px-3 py-2 rounded-lg"
                style={{ backgroundColor: theme.primary, opacity: syncing ? 0.7 : 1 }}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="sync-outline" size={16} color="#fff" />
                    <Text className="text-white text-xs font-semibold ml-1">Sync</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </Card>

        {/* ── Login from Vault ── */}
        <Card className="mx-4 mb-3">
          <Pressable onPress={handleChooseVaultEntry} className="flex-row items-center">
            <Ionicons
              name="lock-closed-outline"
              size={16}
              color={vaultEntry ? theme.primary : colors.textSecondary}
            />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold text-foreground">Fill login from Vault</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {vaultEntry
                  ? `Using "${vaultEntry.title}" — user ID, password and TOTP are filled in for you`
                  : 'Off — tap to choose a Vault entry'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </Pressable>
        </Card>

        {/* ── Holdings ── */}
        {hasCachedData && (
          <>
            <PortfolioSummary
              current={portfolioTotal}
              breakdown={[
                { label: 'Stocks', value: equityTotal },
                { label: 'Mutual funds', value: mfTotal },
              ].filter((b) => b.value > 0)}
              invested={investedTotal}
              funds={fundsAvailable}
              onSaveSnapshot={handleUpdateSnapshot}
              saving={savingSnapshot}
              saveDisabled={!linkedAccountId}
            />

            {allRowCount > 0 && (
              <PortfolioSearchSort query={query} onQuery={setQuery} sort={sort} onSort={changeSort} />
            )}
            <PortfolioSection title="Stocks" rows={stockRows} total={holdings.length} />
            <PortfolioSection title="Mutual funds" rows={mfRows} total={mfHoldings.length} />
            <PortfolioSection title="Open positions" rows={positionRows} total={positions.length} />
            <PortfolioSection title="Active SIPs" rows={sipRows} total={sips.length} />
            <PortfolioSection title="Recent stock orders" rows={orderRows} total={orders.length} />
            <PortfolioSection title="Recent MF orders" rows={mfOrderRows} total={mfOrders.length} />
            {query.trim() !== '' && visibleRowCount === 0 && allRowCount > 0 && (
              <PortfolioNoMatches query={query} />
            )}
          </>
        )}

        {/* ── Manage card ── */}
        {isAuthenticated && (
          <Card className="mx-4 mt-1 mb-3">
            <Pressable
              onPress={() => router.push('/settings/kite-connect-api-key' as any)}
              className="flex-row items-center py-2.5 border-b border-border"
            >
              <Ionicons name="key-outline" size={16} color={colors.text} />
              <Text className="text-sm text-foreground ml-3 flex-1">Update API Key</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={handleDisconnect} className="flex-row items-center py-2.5">
              <Ionicons name="log-out-outline" size={16} color={theme.danger} />
              <Text className="text-sm font-medium ml-3" style={{ color: theme.danger }}>
                Disconnect Kite
              </Text>
            </Pressable>
          </Card>
        )}

      </ScrollView>

      {/* ── Account picker modal ── */}
      <Modal visible={showAccountPicker} transparent animationType="slide">
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 20, maxHeight: '70%' }}>
            <Text className="text-base font-bold text-foreground mb-1">Link Demat Account</Text>
            <Text className="text-xs text-muted-foreground mb-4">
              Which account is your Zerodha demat? This is a one-time setup.
            </Text>
            <ScrollView>
              {pickerAccounts.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => handlePickAccount(a.id)}
                  className="py-3 border-b border-border flex-row items-center"
                >
                  <Ionicons name="trending-up-outline" size={16} color={colors.textSecondary} style={{ marginRight: 10 }} />
                  <Text className="text-sm text-foreground flex-1">{a.label}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </Pressable>
              ))}
              {pickerAccounts.length === 0 && (
                <Text className="text-sm text-muted-foreground text-center py-6">
                  No demat accounts found. Add one from Account Master first.
                </Text>
              )}
            </ScrollView>
            <Pressable
              onPress={() => setShowAccountPicker(false)}
              className="mt-4 py-3 items-center"
            >
              <Text className="text-sm text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Vault entry picker modal ── */}
      <Modal visible={showVaultPicker} transparent animationType="slide">
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 20, maxHeight: '70%' }}>
            <Text className="text-base font-bold text-foreground mb-1">Zerodha login from Vault</Text>
            <Text className="text-xs text-muted-foreground mb-4">
              Pick the entry with your Zerodha user ID and password. Add a TOTP secret to it to fill the code too.
            </Text>
            <ScrollView>
              {vaultCandidates.map((e) => {
                const selected = vaultEntry?.id === e.id;
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => handlePickVaultEntry(e)}
                    className="py-3 border-b border-border flex-row items-center"
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={selected ? theme.primary : colors.textSecondary} style={{ marginRight: 10 }} />
                    <View className="flex-1">
                      <Text className="text-sm text-foreground" style={selected ? { color: theme.primary } : undefined}>{e.title}</Text>
                      <Text className="text-xs text-muted-foreground">{e.username || e.phone || e.email}</Text>
                    </View>
                    {selected && <Ionicons name="checkmark" size={16} color={theme.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            {vaultEntry && (
              <Pressable onPress={() => handlePickVaultEntry(null)} className="mt-4 py-3 items-center">
                <Text className="text-sm font-medium" style={{ color: theme.danger }}>Stop filling from Vault</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setShowVaultPicker(false)} className="mt-2 py-3 items-center">
              <Text className="text-sm text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
