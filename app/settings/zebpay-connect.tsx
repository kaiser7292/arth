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
import { todayIso } from '@/utils/date';
import { addOrUpdateSnapshot } from '@/services/financial-account';
import { getDematAccountsForPicker } from '@/services/kite-connect';
import {
  isZebpayConnected,
  isZebpayTokenExpired,
  getZebpayLastSynced,
  getZebpayCache,
  syncZebpayData,
  clearZebpayCredentials,
  type ZebpayBalance,
  type ZebpayOrder,
} from '@/services/zebpay-connect';

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-border last:border-0">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <View className="items-end">
        <Text className="text-sm font-semibold text-foreground">{value}</Text>
        {sub ? <Text className="text-xs text-muted-foreground">{sub}</Text> : null}
      </View>
    </View>
  );
}

export default function ZebpayConnectScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [connected, setConnected]         = useState(false);
  const [expired, setExpired]             = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [lastSynced, setLastSynced]       = useState<string | null>(null);
  const [balances, setBalances]           = useState<ZebpayBalance[]>([]);
  const [orders, setOrders]               = useState<ZebpayOrder[]>([]);
  const [totalInr, setTotalInr]           = useState(0);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccounts, setPickerAccounts] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(() => {
    const conn = isZebpayConnected();
    setConnected(conn);
    setExpired(isZebpayTokenExpired());
    setLastSynced(getZebpayLastSynced());
    if (conn) {
      const cache = getZebpayCache();
      setBalances(cache.balances);
      setOrders(cache.orders);
      setTotalInr(cache.totalInr);
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
      setLastSynced(getZebpayLastSynced());
      setExpired(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Sync Failed', msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateSnapshot = async () => {
    if (!linkedAccountId) {
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
      await addOrUpdateSnapshot(linkedAccountId, todayIso(), totalInr);
      alert('Snapshot Saved', `Crypto portfolio ${formatAmount(totalInr)} saved for today.`);
    } catch (err: any) {
      alert('Error', err.message || 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handlePickAccount = (id: string) => {
    setLinkedAccountId(id);
    setShowAccountPicker(false);
    handleUpdateSnapshot();
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
              setBalances([]); setOrders([]); setTotalInr(0); setLinkedAccountId(null);
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

  const pendingOrders = orders.filter(o => o.status === 'pending');

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mx-4 mt-3">

          {/* Status + Sync row */}
          <Card className="mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: expired ? (theme.warning ?? '#F59E0B') : (theme.success ?? '#10B981') }} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {expired ? 'Session Expired' : 'Connected'}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {lastSynced
                      ? `Last synced ${new Date(lastSynced).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Not yet synced'}
                  </Text>
                </View>
              </View>
              {expired ? (
                <Pressable
                  onPress={() => router.push('/settings/zebpay-connect-credentials' as any)}
                  className="flex-row items-center px-3 py-2 rounded-lg"
                  style={{ backgroundColor: theme.warning ?? '#F59E0B' }}
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

          {/* Portfolio summary */}
          <Card className="mb-3">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Portfolio Summary
            </Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm text-muted-foreground">Crypto Portfolio</Text>
              <Text className="text-sm font-bold" style={{ color: theme.success ?? '#10B981' }}>
                {formatAmount(totalInr)}
              </Text>
            </View>
            <View className="pt-2 mt-1 border-t border-border">
              <Pressable
                onPress={handleUpdateSnapshot}
                disabled={savingSnapshot || expired}
                className="rounded-lg p-3 flex-row items-center justify-center"
                style={{ backgroundColor: theme.alpha('primary', 0.1), opacity: (savingSnapshot || expired) ? 0.5 : 1 }}
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

          {/* Holdings */}
          {balances.length > 0 && (
            <Card className="mb-3">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Holdings
              </Text>
              {balances.map(b => (
                <View key={b.currency} className="flex-row justify-between items-center py-2.5 border-b border-border last:border-0">
                  <View>
                    <Text className="text-sm font-semibold text-foreground">{b.currency}</Text>
                    <Text className="text-xs text-muted-foreground">{b.balance.toFixed(8)} {b.currency}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold text-foreground">{formatAmount(b.inrValue)}</Text>
                    {b.currentPrice > 0 && (
                      <Text className="text-xs text-muted-foreground">@ {formatAmount(b.currentPrice)}</Text>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}

          {/* Open Orders */}
          {pendingOrders.length > 0 && (
            <Card className="mb-3">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Open Orders ({pendingOrders.length})
              </Text>
              {pendingOrders.slice(0, 10).map(o => (
                <View key={o.id} className="flex-row justify-between items-center py-2.5 border-b border-border last:border-0">
                  <View className="flex-row items-center gap-2">
                    <View className="rounded px-1.5 py-0.5"
                      style={{ backgroundColor: o.side.toLowerCase() === 'bid' || o.side.toLowerCase() === 'buy'
                        ? `${theme.success ?? '#10B981'}22` : `${theme.danger}22` }}>
                      <Text className="text-xs font-bold"
                        style={{ color: o.side.toLowerCase() === 'bid' || o.side.toLowerCase() === 'buy'
                          ? (theme.success ?? '#10B981') : theme.danger }}>
                        {o.side.toUpperCase()}
                      </Text>
                    </View>
                    <Text className="text-sm text-foreground">{o.trade_pair}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold text-foreground">{o.size} @ {formatAmount(o.price)}</Text>
                    <Text className="text-xs text-muted-foreground">{o.type}</Text>
                  </View>
                </View>
              ))}
            </Card>
          )}

          {/* No data yet */}
          {balances.length === 0 && orders.length === 0 && (
            <Card className="mb-3 items-center py-6">
              <Ionicons name="bar-chart-outline" size={32} color={colors.textSecondary} />
              <Text className="text-sm text-muted-foreground mt-2">
                {expired ? 'Reconnect to load your portfolio' : 'Tap "Sync Portfolio" to load your data'}
              </Text>
            </Card>
          )}

          {/* Manage */}
          <Card>
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
