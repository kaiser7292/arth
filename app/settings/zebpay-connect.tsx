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
  isZebpayConnected,
  getZebpayLastSynced,
  getZebpayCache,
  syncZebpayData,
  clearZebpayCredentials,
  type ZebpayBalance,
  type ZebpayOrder,
} from '@/services/zebpay-connect';
import { zebpayBalanceRow, zebpayOrderRow } from '@/services/portfolio-rows';
import {
  PortfolioNoMatches,
  PortfolioSearchSort,
  PortfolioSection,
  PortfolioSummary,
  usePortfolioView,
} from '@/components/portfolio/PortfolioList';

export default function ZebpayConnectScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [connected, setConnected]         = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [lastSynced, setLastSynced]       = useState<string | null>(null);
  const [balances, setBalances]           = useState<ZebpayBalance[]>([]);
  const [orders, setOrders]               = useState<ZebpayOrder[]>([]);
  const [totalInr, setTotalInr]           = useState(0);
  const [inrBalance, setInrBalance]       = useState(0);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(() => getBrokerLinkedAccount('zebpay'));
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccounts, setPickerAccounts] = useState<{ id: string; label: string }[]>([]);
  const { query, setQuery, sort, changeSort, view } = usePortfolioView('zebpay');

  const load = useCallback(() => {
    const conn = isZebpayConnected();
    setConnected(conn);
    setLastSynced(getZebpayLastSynced());
    if (conn) {
      const cache = getZebpayCache();
      setBalances(cache.balances);
      setOrders(cache.orders);
      setTotalInr(cache.totalInr);
      setInrBalance(cache.inrBalance);
    }
  }, []);

  useFocusEffect(load);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncZebpayData();
      setBalances(result.balances);
      setOrders(result.orders);
      setTotalInr(result.totalInr);
      setInrBalance(result.inrBalance);
      setLastSynced(getZebpayLastSynced());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Sync Failed', msg);
    } finally {
      setSyncing(false);
    }
  };

  // accountIdOverride: the account just picked (state hasn't updated yet at that point).
  const handleUpdateSnapshot = async (accountIdOverride?: string) => {
    const accountId = accountIdOverride ?? linkedAccountId;
    if (!accountId) {
      const accounts = await getDematAccountsForPicker().catch(() => []);
      if (accounts.length === 0) {
        alert('No Account', 'Add a demat/investment account in Accounts first, then link it here.');
        return;
      }
      setPickerAccounts(accounts);
      setShowAccountPicker(true);
      return;
    }
    setSavingSnapshot(true);
    try {
      // Crypto holdings are the portfolio; the INR wallet balance is the fund (0 when empty).
      const saved = await saveBrokerSnapshot(accountId, totalInr, inrBalance);
      alert('Snapshot Saved', `Crypto portfolio ${formatAmount(saved.portfolio)} and INR funds ${formatAmount(saved.fund)} saved for today.`);
    } catch (err: any) {
      alert('Error', err.message || 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handlePickAccount = (id: string) => {
    setLinkedAccountId(id);
    setBrokerLinkedAccount('zebpay', id);
    setShowAccountPicker(false);
    handleUpdateSnapshot(id);
  };

  const handleDisconnect = () => {
    alert(
      'Disconnect Zebpay',
      'This will remove your Zebpay credentials and cached data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearZebpayCredentials();
              setConnected(false);
              setBalances([]); setOrders([]); setTotalInr(0); setInrBalance(0); setLinkedAccountId(null);
              setBrokerLinkedAccount('zebpay', null);
            } catch (e) {
              logger.error('Failed to disconnect Zebpay:', e);
            }
          },
        },
      ],
    );
  };

  // ── Disconnected ─────────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="mx-4 mt-3">
            <Card className="mb-3 items-center py-6">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-4"
                style={{ backgroundColor: `${theme.primary}22` }}>
                <Ionicons name="logo-bitcoin" size={28} color={theme.primary} />
              </View>
              <Text className="text-base font-bold text-foreground mb-1">Zebpay</Text>
              <Text className="text-sm text-muted-foreground text-center mb-5 px-4">
                Connect your Zebpay account to view your crypto portfolio, balances, and orders in Arth.
              </Text>
              <Pressable
                onPress={() => router.push('/settings/zebpay-connect-credentials' as any)}
                className="rounded-lg px-6 py-3 flex-row items-center"
                style={{ backgroundColor: theme.primary }}
              >
                <Ionicons name="link-outline" size={18} color="#fff" />
                <Text className="text-white font-semibold text-sm ml-2">Connect Zebpay</Text>
              </Pressable>
            </Card>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────────

  const openOrders = orders.filter(o => o.status === 'pending').slice(0, 10);
  const balanceRows = view(balances.map(zebpayBalanceRow));
  const orderRows = view(openOrders.map(zebpayOrderRow), false);
  const allRowCount = balances.length + openOrders.length;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mt-3">

          {/* Status + Sync row */}
          <Card className="mx-4 mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: theme.success }} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">Connected</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {lastSynced
                      ? `Last synced ${new Date(lastSynced).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Not yet synced'}
                  </Text>
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
                    <Ionicons name="sync-outline" size={16} color="#fff" />
                    <Text className="text-white text-xs font-semibold ml-1">Sync</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Card>

          {(balances.length > 0 || totalInr > 0) && (
            <PortfolioSummary
              current={totalInr}
              funds={inrBalance > 0 ? inrBalance : null}
              onSaveSnapshot={() => handleUpdateSnapshot()}
              saving={savingSnapshot}
            />
          )}

          {allRowCount > 0 && (
            <PortfolioSearchSort query={query} onQuery={setQuery} sort={sort} onSort={changeSort} />
          )}
          <PortfolioSection title="Crypto" rows={balanceRows} total={balances.length} />
          <PortfolioSection title="Open orders" rows={orderRows} total={openOrders.length} />
          {query.trim() !== '' && balanceRows.length + orderRows.length === 0 && allRowCount > 0 && (
            <PortfolioNoMatches query={query} />
          )}

          {/* No data yet */}
          {balances.length === 0 && orders.length === 0 && (
            <Card className="mx-4 mb-3 items-center py-6">
              <Ionicons name="bar-chart-outline" size={32} color={colors.textSecondary} />
              <Text className="text-sm text-muted-foreground mt-2">Tap Sync to load your portfolio</Text>
            </Card>
          )}

          {/* Manage */}
          <Card className="mx-4">
            <Pressable
              onPress={() => router.push('/settings/zebpay-connect-credentials' as any)}
              className="flex-row items-center py-2.5 border-b border-border"
            >
              <Ionicons name="key-outline" size={16} color={colors.text} />
              <Text className="text-sm text-foreground ml-3 flex-1">Update Credentials</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={handleDisconnect} className="flex-row items-center py-2.5">
              <Ionicons name="log-out-outline" size={16} color={theme.danger} />
              <Text className="text-sm font-medium ml-3" style={{ color: theme.danger }}>
                Disconnect Zebpay
              </Text>
            </Pressable>
          </Card>

        </View>
      </ScrollView>

      {/* Demat account picker modal */}
      <Modal visible={showAccountPicker} transparent animationType="slide">
        <Pressable className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowAccountPicker(false)} />
        <View className="bg-background rounded-t-2xl p-4 pb-8" style={{ maxHeight: '60%' }}>
          <Text className="text-base font-bold text-foreground mb-1">Link an Account</Text>
          <Text className="text-xs text-muted-foreground mb-4">
            Choose the account where Zebpay portfolio snapshots will be saved.
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
