import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { WebView } from 'react-native-webview';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlert } from '@/hooks/use-alert';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/utils/format';
import { todayIso } from '@/utils/date';
import { addOrUpdateSnapshot, updateFundBalance } from '@/services/financial-account';
import {
  clearKiteCredentials,
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

  const load = useCallback(async () => {
    try {
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
      setLoginUrl(getKiteLoginUrl(credentials.apiKey));
      setShowWebView(true);
    } catch {
      alert('Error', 'Failed to initiate Kite login');
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
            await clearKiteCredentials();
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
    const parsed = Linking.parse(url);
    const requestToken = parsed.queryParams?.request_token as string;
    if (!requestToken) {
      alert('Error', 'Authentication failed or was cancelled');
      return;
    }

    try {
      setIsLoading(true);
      const credentials = await exchangeRequestToken(requestToken);
      await storeKiteAccessToken(credentials);
      setIsAuthenticated(true);
      setTokenExpired(false);
      alert('Success', 'Connected to Kite!');
    } catch {
      alert('Error', 'Failed to complete authentication');
    } finally {
      setIsLoading(false);
    }
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
      if (err.message === 'TOKEN_EXPIRED') {
        setTokenExpired(true);
        alert('Token Expired', 'Your Kite session expired at 6 AM. Tap "Reconnect" to log in again.');
      } else if (err.message === 'NO_ACCOUNT_LINKED') {
        // Trigger picker
        const accounts = await getDematAccountsForPicker();
        setPickerAccounts(accounts);
        setShowAccountPicker(true);
      } else {
        alert('Sync Failed', err.message || 'Could not fetch data from Kite');
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
      const today = todayIso();
      await Promise.all([
        addOrUpdateSnapshot(linkedAccountId, today, portfolioTotal),
        updateFundBalance(linkedAccountId, fundsAvailable),
      ]);
      alert('Snapshot Saved', `Portfolio ₹${formatAmount(portfolioTotal)} and funds ₹${formatAmount(fundsAvailable)} saved for today.`);
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
        <WebView
          source={{ uri: loginUrl }}
          onNavigationStateChange={handleWebViewNavChange}
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
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  const isConnected = isAuthenticated && !tokenExpired;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Status card ── */}
        <Card className="mx-4 mt-3 mb-3">
          <View className="flex-row items-center mb-3">
            <View
              className="w-9 h-9 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha('primary', 0.08) }}
            >
              <Ionicons
                name="trending-up-outline"
                size={18}
                color={isConnected ? theme.success : tokenExpired ? theme.warning : colors.textSecondary}
              />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground">Zerodha Kite</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {!isAuthenticated
                  ? 'Not connected'
                  : tokenExpired
                  ? 'Session expired — reconnect to sync'
                  : lastSynced
                  ? `Last synced: ${formatSyncTime(lastSynced)}`
                  : 'Connected — tap Sync to fetch data'}
              </Text>
            </View>
            {isAuthenticated && (
              <Pressable onPress={handleDisconnect} hitSlop={8}>
                <Text className="text-xs text-danger">Disconnect</Text>
              </Pressable>
            )}
          </View>

          {/* Action buttons */}
          {!isAuthenticated ? (
            <Pressable
              onPress={handleConnectPress}
              className="rounded-lg p-3 flex-row items-center justify-center"
              style={{ backgroundColor: theme.primary }}
            >
              <Ionicons name="log-in-outline" size={16} color="#fff" />
              <Text className="text-white font-semibold text-sm ml-2">Connect to Kite</Text>
            </Pressable>
          ) : tokenExpired ? (
            <Pressable
              onPress={handleConnectPress}
              className="rounded-lg p-3 flex-row items-center justify-center"
              style={{ backgroundColor: theme.warning }}
            >
              <Ionicons name="refresh-outline" size={16} color="#fff" />
              <Text className="text-white font-semibold text-sm ml-2">Reconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSync}
              disabled={syncing}
              className="rounded-lg p-3 flex-row items-center justify-center"
              style={{ backgroundColor: theme.primary, opacity: syncing ? 0.7 : 1 }}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sync-outline" size={16} color="#fff" />
              )}
              <Text className="text-white font-semibold text-sm ml-2">
                {syncing ? 'Syncing…' : 'Sync Now'}
              </Text>
            </Pressable>
          )}
        </Card>

        {/* ── Holdings ── */}
        {hasCachedData && (
          <>
            {/* Totals */}
            <Card className="mx-4 mb-3">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Portfolio Summary
              </Text>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Equity Holdings</Text>
                <Text className="text-sm font-semibold text-foreground">{formatAmount(equityTotal)}</Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-muted-foreground">Mutual Funds</Text>
                <Text className="text-sm font-semibold text-foreground">{formatAmount(mfTotal)}</Text>
              </View>
              <View className="flex-row justify-between mb-2 pt-2 border-t border-border">
                <Text className="text-sm font-semibold text-foreground">Portfolio Total</Text>
                <Text className="text-sm font-bold" style={{ color: theme.success }}>
                  {formatAmount(portfolioTotal)}
                </Text>
              </View>
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm text-muted-foreground">Available Funds</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatAmount(fundsAvailable)}
                </Text>
              </View>
              <View className="pt-2 border-t border-border">
                <Pressable
                  onPress={handleUpdateSnapshot}
                  disabled={savingSnapshot || !linkedAccountId}
                  className="rounded-lg p-3 flex-row items-center justify-center"
                  style={{
                    backgroundColor: theme.alpha('primary', 0.1),
                    opacity: savingSnapshot || !linkedAccountId ? 0.5 : 1,
                  }}
                >
                  {savingSnapshot ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <Ionicons name="save-outline" size={16} color={theme.primary} />
                  )}
                  <Text className="text-sm font-semibold ml-2" style={{ color: theme.primary }}>
                    {savingSnapshot ? 'Saving…' : 'Update Snapshot with These Values'}
                  </Text>
                </Pressable>
              </View>
            </Card>

            {/* Equity holdings list */}
            {holdings.length > 0 && (
              <View className="mx-4 mb-2 mt-1">
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Equity Holdings ({holdings.length})
                </Text>
              </View>
            )}

            {holdings.map((h) => {
              const totalQty = h.quantity + (h.t1_quantity ?? 0);
              const marketValue = totalQty * h.last_price;
              const pnlPositive = h.pnl >= 0;
              return (
                <Card key={h.isin} className="mx-4 mb-2">
                  <View className="flex-row items-center">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">{h.tradingsymbol}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {totalQty} qty{h.t1_quantity > 0 ? ` (${h.t1_quantity} pending)` : ''} · avg ₹{h.average_price.toFixed(2)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-bold text-foreground">
                        {formatAmount(marketValue)}
                      </Text>
                      <Text
                        className="text-xs mt-0.5"
                        style={{ color: pnlPositive ? theme.success : theme.danger }}
                      >
                        {pnlPositive ? '+' : ''}{formatAmount(h.pnl)}
                        {' '}({h.day_change_percentage >= 0 ? '+' : ''}{h.day_change_percentage.toFixed(2)}%)
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}

            {/* Mutual fund holdings list */}
            {mfHoldings.length > 0 && (
              <View className="mx-4 mb-2 mt-1">
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Mutual Funds ({mfHoldings.length})
                </Text>
              </View>
            )}

            {mfHoldings.map((h) => {
              const marketValue = h.quantity * h.last_price;
              const pnlPositive = h.pnl >= 0;
              return (
                <Card key={h.tradingsymbol + (h.folio ?? '')} className="mx-4 mb-2">
                  <View className="flex-row items-center">
                    <View className="flex-1 mr-3">
                      <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>
                        {h.fund}
                      </Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {h.quantity.toFixed(3)} units · NAV ₹{h.last_price.toFixed(2)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-bold text-foreground">
                        {formatAmount(marketValue)}
                      </Text>
                      <Text
                        className="text-xs mt-0.5"
                        style={{ color: pnlPositive ? theme.success : theme.danger }}
                      >
                        {pnlPositive ? '+' : ''}{formatAmount(h.pnl)}
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}

            {/* Open positions */}
            {positions.length > 0 && (
              <>
                <View className="mx-4 mb-2 mt-3">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Open Positions ({positions.length})
                  </Text>
                </View>
                {positions.map((p) => {
                  const pnlPositive = p.pnl >= 0;
                  const isShort = p.quantity < 0;
                  return (
                    <Card key={`${p.tradingsymbol}-${p.product}`} className="mx-4 mb-2">
                      <View className="flex-row items-center">
                        <View className="flex-1">
                          <View className="flex-row items-center">
                            <Text className="text-sm font-semibold text-foreground mr-2">{p.tradingsymbol}</Text>
                            <View
                              className="rounded px-1.5 py-0.5"
                              style={{ backgroundColor: theme.alpha(isShort ? 'danger' : 'success', 0.12) }}
                            >
                              <Text className="text-xs font-semibold" style={{ color: isShort ? theme.danger : theme.success }}>
                                {isShort ? 'SHORT' : 'LONG'}
                              </Text>
                            </View>
                          </View>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {Math.abs(p.quantity)} qty · avg ₹{p.average_price.toFixed(2)} · {p.product}
                          </Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-sm font-bold text-foreground">
                            ₹{p.last_price.toFixed(2)}
                          </Text>
                          <Text
                            className="text-xs mt-0.5"
                            style={{ color: pnlPositive ? theme.success : theme.danger }}
                          >
                            {pnlPositive ? '+' : ''}{formatAmount(p.pnl)}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </>
            )}

            {/* Active SIPs */}
            {sips.length > 0 && (
              <>
                <View className="mx-4 mb-2 mt-3">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Active SIPs ({sips.length})
                  </Text>
                </View>
                {sips.map((s) => (
                  <Card key={s.sip_id} className="mx-4 mb-2">
                    <View className="flex-row items-center">
                      <View className="flex-1 mr-3">
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>{s.fund}</Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {s.frequency.charAt(0).toUpperCase() + s.frequency.slice(1)} · Day {s.instalment_day}
                          {s.instalments_remaining > 0 ? ` · ${s.instalments_remaining} left` : ''}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-sm font-bold text-foreground">{formatAmount(s.instalment_amount)}</Text>
                        {s.next_instalment ? (
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            Next: {new Date(s.next_instalment).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                ))}
              </>
            )}

            {/* Recent equity orders */}
            {orders.length > 0 && (
              <>
                <View className="mx-4 mb-2 mt-3">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Recent Equity Orders
                  </Text>
                </View>
                {orders.map((o) => {
                  const isBuy = o.transaction_type === 'BUY';
                  const isComplete = o.status === 'COMPLETE';
                  const isRejected = o.status === 'REJECTED' || o.status === 'CANCELLED';
                  const statusColor = isComplete ? theme.success : isRejected ? theme.danger : colors.textSecondary;
                  return (
                    <Card key={o.order_id} className="mx-4 mb-2">
                      <View className="flex-row items-center">
                        <View className="flex-1">
                          <View className="flex-row items-center">
                            <Text className="text-sm font-semibold text-foreground mr-2">{o.tradingsymbol}</Text>
                            <View
                              className="rounded px-1.5 py-0.5"
                              style={{ backgroundColor: theme.alpha(isBuy ? 'success' : 'danger', 0.12) }}
                            >
                              <Text className="text-xs font-semibold" style={{ color: isBuy ? theme.success : theme.danger }}>
                                {o.transaction_type}
                              </Text>
                            </View>
                          </View>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {o.quantity} qty · {o.order_type}
                            {o.average_price > 0 ? ` · avg ₹${o.average_price.toFixed(2)}` : o.price > 0 ? ` · ₹${o.price.toFixed(2)}` : ''}
                          </Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-xs font-semibold" style={{ color: statusColor }}>
                            {o.status}
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {new Date(o.order_timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </>
            )}

            {/* Recent MF orders */}
            {mfOrders.length > 0 && (
              <>
                <View className="mx-4 mb-2 mt-3">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Recent MF Orders
                  </Text>
                </View>
                {mfOrders.map((o) => {
                  const isBuy = o.order_type === 'BUY';
                  const isConfirmed = o.status === 'CONFIRMED';
                  const isRejected = o.status === 'REJECTED' || o.status === 'CANCELLED';
                  const statusColor = isConfirmed ? theme.success : isRejected ? theme.danger : colors.textSecondary;
                  return (
                    <Card key={o.order_id} className="mx-4 mb-2">
                      <View className="flex-row items-center">
                        <View className="flex-1 mr-3">
                          <View className="flex-row items-center flex-wrap">
                            <Text className="text-sm font-semibold text-foreground mr-2" numberOfLines={1} style={{ flex: 1 }}>
                              {o.fund}
                            </Text>
                            <View
                              className="rounded px-1.5 py-0.5"
                              style={{ backgroundColor: theme.alpha(isBuy ? 'success' : 'danger', 0.12) }}
                            >
                              <Text className="text-xs font-semibold" style={{ color: isBuy ? theme.success : theme.danger }}>
                                {o.order_type}
                              </Text>
                            </View>
                          </View>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {o.amount > 0 ? `₹${formatAmount(o.amount)}` : `${o.quantity?.toFixed(3)} units`}
                            {o.price > 0 ? ` · NAV ₹${o.price.toFixed(4)}` : ''}
                          </Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-xs font-semibold" style={{ color: statusColor }}>
                            {o.status}
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {new Date(o.order_timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </>
            )}
          </>
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
    </ScreenContainer>
  );
}
