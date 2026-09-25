import React, { useState, useCallback } from 'react';
import { ActivityIndicator, Modal, ScrollView, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/hooks/use-alert';
import { logger } from '@/utils/logger';
import { formatAmount } from '@/utils/format';
import { saveBrokerSnapshot } from '@/services/financial-account';
import { getBrokerLinkedAccount, setBrokerLinkedAccount } from '@/services/broker-link';
import { getDematAccountsForPicker } from '@/services/kite-connect';
import {
  isAngelConnected,
  isAngelTokenExpired,
  getAngelLastSynced,
  getAngelClientId,
  syncAngelData,
  clearAngelSession,
  getCachedAngelHoldings,
  getCachedAngelPositions,
  getCachedAngelOrders,
  getCachedAngelFunds,
  getCachedAngelTotalHolding,
  type AngelHolding,
  type AngelPosition,
  type AngelOrder,
  type AngelFunds,
  type AngelTotalHolding,
} from '@/services/angel-connect';
import { angelHoldingRow, angelOrderRow, angelPositionRow } from '@/services/portfolio-rows';
import {
  PortfolioNoMatches,
  PortfolioSearchSort,
  PortfolioSection,
  PortfolioSummary,
  usePortfolioView,
} from '@/components/portfolio/PortfolioList';

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function parseMoney(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return parseFloat(v) || 0;
}

export default function AngelConnectScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [connected, setConnected] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(() => getBrokerLinkedAccount('angel'));
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccounts, setPickerAccounts] = useState<{ id: string; label: string }[]>([]);

  const [holdings, setHoldings] = useState<AngelHolding[]>([]);
  const [totalHolding, setTotalHolding] = useState<AngelTotalHolding | null>(null);
  const [positions, setPositions] = useState<AngelPosition[]>([]);
  const [orders, setOrders] = useState<AngelOrder[]>([]);
  const [funds, setFunds] = useState<AngelFunds | null>(null);
  const { query, setQuery, sort, changeSort, view } = usePortfolioView('angel');

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        const conn = isAngelConnected();
        setConnected(conn);
        setTokenExpired(isAngelTokenExpired());
        setLastSynced(getAngelLastSynced());
        try { setClientId(await getAngelClientId()); } catch { /* non-fatal */ }
        if (conn) {
          setHoldings(getCachedAngelHoldings());
          setPositions(getCachedAngelPositions());
          setOrders(getCachedAngelOrders());
          setFunds(getCachedAngelFunds());
          setTotalHolding(getCachedAngelTotalHolding());
        }
      };
      load().catch(e => logger.error('Angel screen load error:', e));
    }, []),
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncAngelData();
      setHoldings(result.holdings);
      setTotalHolding(result.totalHolding);
      setPositions(result.positions);
      setOrders(result.orders);
      setFunds(result.funds);
      setLastSynced(result.lastSynced);
      setTokenExpired(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Sync Failed', msg || 'Could not sync Angel One data.');
    } finally {
      setSyncing(false);
    }
  }, [alert]);

  // accountIdOverride: the account just picked. State hasn't updated yet at that point, so reading
  // linkedAccountId there would re-open the picker instead of saving.
  const handleUpdateSnapshot = async (accountIdOverride?: string) => {
    const accountId = accountIdOverride ?? linkedAccountId;
    if (!accountId) {
      const accounts = await getDematAccountsForPicker().catch(() => []);
      if (accounts.length === 0) {
        alert('No Demat Account', 'Add a demat/investment account in Accounts first, then link it here.');
        return;
      }
      setPickerAccounts(accounts);
      setShowAccountPicker(true);
      return;
    }
    const portfolioTotal = parseMoney(totalHolding?.totalholdingvalue);
    const fundsAvailable = parseMoney(funds?.availablecash ?? funds?.net);
    setSavingSnapshot(true);
    try {
      // Portfolio and funds are always saved together; funds of 0 are saved as 0.
      const saved = await saveBrokerSnapshot(accountId, portfolioTotal, fundsAvailable);
      alert('Snapshot Saved', `Portfolio ${formatAmount(saved.portfolio)} and funds ${formatAmount(saved.fund)} saved for today.`);
    } catch (err: any) {
      alert('Error', err.message || 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handlePickAccount = (id: string) => {
    setLinkedAccountId(id);
    setBrokerLinkedAccount('angel', id);
    setShowAccountPicker(false);
    handleUpdateSnapshot(id);
  };

  const handleDisconnect = useCallback(() => {
    alert(
      'Disconnect',
      'This will clear your Angel One session. Your stored credentials remain so you can reconnect instantly.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAngelSession();
              setConnected(false);
              setHoldings([]); setPositions([]); setOrders([]); setFunds(null); setTotalHolding(null);
              setLastSynced(null);
            } catch (e) {
              logger.error('Angel disconnect error:', e);
            }
          },
        },
      ],
    );
  }, [alert]);

  // ── Disconnected state ──────────────────────────────────────────────────────
  if (!connected) {
    return (
      <ScreenContainer padTop={false}>
        <View className="mx-4 mt-3">
          <Card className="mb-3">
            <View className="items-center py-4">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: theme.alpha('primary', 0.1) }}>
                <Ionicons name="trending-up-outline" size={28} color={theme.primary} />
              </View>
              <Text className="text-base font-semibold text-foreground mb-1">Angel One SmartAPI</Text>
              <Text className="text-xs text-muted-foreground text-center mb-4">
                Connect your Angel One account to sync holdings, positions, orders, and margin data automatically.
              </Text>
              <Pressable
                onPress={() => router.push('/settings/angel-connect-credentials' as any)}
                className="flex-row items-center px-6 py-3 rounded-lg"
                style={{ backgroundColor: theme.primary }}
              >
                <Ionicons name="link-outline" size={18} color="#fff" />
                <Text className="text-white font-semibold text-sm ml-2">Connect Angel One</Text>
              </Pressable>
            </View>
          </Card>

          <Card>
            <View className="flex-row items-center mb-2">
              <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
              <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>What gets synced</Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5">
              {'• Equity holdings — symbol, qty, avg price, LTP, P&L\n'}
              {'• Open positions — intraday and carry-forward\n'}
              {'• Order book — recent equity orders\n'}
              {'• Funds — available cash, margin, overall P&L\n\n'}
              {'Auto-login: your TOTP is generated on-device from your stored secret — no manual 2FA entry needed.'}
            </Text>
          </Card>
        </View>
      </ScreenContainer>
    );
  }

  // ── Connected state ─────────────────────────────────────────────────────────
  const openPositions = positions.filter(p => p.netqty !== 0);
  const recentOrders = orders.slice(0, 10);
  const holdingRows = view(holdings.map(angelHoldingRow));
  const positionRows = view(openPositions.map(angelPositionRow));
  const orderRows = view(recentOrders.map(angelOrderRow), false);
  const allRowCount = holdings.length + openPositions.length + recentOrders.length;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mt-3">

          {/* Status card */}
          <Card className="mx-4 mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: tokenExpired ? theme.warning : theme.success }} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {tokenExpired ? 'Session Expired' : 'Connected'}
                    {clientId ? ` · ${clientId}` : ''}
                  </Text>
                  {lastSynced && (
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Last synced {formatRelativeTime(lastSynced)}
                    </Text>
                  )}
                </View>
              </View>
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
                    <Ionicons name="refresh-outline" size={16} color="#fff" />
                    <Text className="text-white text-xs font-semibold ml-1">Sync</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Card>

          {(totalHolding || funds) && (
            <PortfolioSummary
              current={parseMoney(totalHolding?.totalholdingvalue)}
              invested={totalHolding ? parseMoney(totalHolding.totalinvvalue) : null}
              funds={funds ? parseMoney(funds.availablecash) : null}
              extras={funds && parseMoney(funds.totalpnl) !== 0
                ? [{ label: "Today's P&L", value: parseMoney(funds.totalpnl), signed: true }]
                : undefined}
              onSaveSnapshot={() => handleUpdateSnapshot()}
              saving={savingSnapshot}
            />
          )}

          {allRowCount > 0 && (
            <PortfolioSearchSort query={query} onQuery={setQuery} sort={sort} onSort={changeSort} />
          )}
          <PortfolioSection title="Stocks" rows={holdingRows} total={holdings.length} />
          <PortfolioSection title="Open positions" rows={positionRows} total={openPositions.length} />
          <PortfolioSection title="Recent orders" rows={orderRows} total={recentOrders.length} />
          {query.trim() !== '' && holdingRows.length + positionRows.length + orderRows.length === 0 && allRowCount > 0 && (
            <PortfolioNoMatches query={query} />
          )}

          {/* Manage */}
          <Card className="mx-4">
            <Pressable
              onPress={() => router.push('/settings/angel-connect-credentials' as any)}
              className="flex-row items-center py-2.5 border-b border-border"
            >
              <Ionicons name="key-outline" size={16} color={colors.text} />
              <Text className="text-sm text-foreground ml-3 flex-1">Update Credentials</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={handleDisconnect} className="flex-row items-center py-2.5">
              <Ionicons name="log-out-outline" size={16} color={theme.danger} />
              <Text className="text-sm font-medium ml-3" style={{ color: theme.danger }}>
                Disconnect Angel One
              </Text>
            </Pressable>
          </Card>

        </View>
      </ScrollView>

      {/* Demat account picker modal */}
      <Modal visible={showAccountPicker} transparent animationType="slide">
        <Pressable className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowAccountPicker(false)} />
        <View className="bg-background rounded-t-2xl p-4 pb-8" style={{ maxHeight: '60%' }}>
          <Text className="text-base font-bold text-foreground mb-1">Link a Demat Account</Text>
          <Text className="text-xs text-muted-foreground mb-4">
            Choose the account where Angel One portfolio snapshots will be saved.
          </Text>
          {pickerAccounts.map(a => (
            <Pressable
              key={a.id}
              onPress={() => handlePickAccount(a.id)}
              className="py-3 border-b border-border flex-row items-center"
            >
              <Ionicons name="briefcase-outline" size={16} color={colors.textSecondary} />
              <Text className="text-sm text-foreground ml-3">{a.label}</Text>
            </Pressable>
          ))}
          {pickerAccounts.length === 0 && (
            <Text className="text-sm text-muted-foreground text-center py-4">
              No demat/investment accounts found. Add one in Accounts first.
            </Text>
          )}
          <Pressable
            onPress={() => setShowAccountPicker(false)}
            className="mt-4 py-3 rounded-lg items-center"
            style={{ backgroundColor: colors.border }}
          >
            <Text className="text-sm font-semibold text-foreground">Cancel</Text>
          </Pressable>
        </View>
      </Modal>

    </ScreenContainer>
  );
}
