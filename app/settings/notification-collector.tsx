import { Card, ScreenContainer } from '@/components/ui';
import { StatusColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlert } from '@/hooks/use-alert';
import {
    clearAllNotifications,
    deleteNotification,
    getCollectedNotifications,
    getNotificationCount,
    isNotificationCollectionEnabled,
    markNotificationAsNotUseful,
    markNotificationAsUseful,
    setNotificationCollectionEnabled,
    setupNotificationListener,
    type CollectedNotification
} from '@/services/notification-collector';
import { formatTimestampInTimezone } from '@/utils/timezone';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

export default function NotificationCollectorScreen() {
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const [notifications, setNotifications] = useState<CollectedNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [usefulCount, setUsefulCount] = useState(0);
  const [collectionEnabled, setCollectionEnabled] = useState(false);

  useEffect(() => {
    loadNotifications();
    loadCollectionEnabledState();
    
    // Setup notification listener
    setupNotificationListener().catch(error => {
      console.error('Error setting up notification listener:', error);
    });
  }, []);

  const loadCollectionEnabledState = async () => {
    try {
      const enabled = await isNotificationCollectionEnabled();
      setCollectionEnabled(enabled);
    } catch (error) {
      console.error('Error loading collection enabled state:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const data = await getCollectedNotifications();
      setNotifications(data);
      const count = await getNotificationCount();
      setTotalCount(count);

      // Count useful ones
      const useful = data.filter(n => n.is_useful === 1).length;
      setUsefulCount(useful);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkUseful = async (id: number) => {
    try {
      await markNotificationAsUseful(id, notes || undefined);
      setNotes('');
      setSelectedId(null);
      await loadNotifications();
      alert('Success', 'Marked as useful');
    } catch (error) {
      alert('Error', 'Failed to mark as useful');
    }
  };

  const handleMarkNotUseful = async (id: number) => {
    try {
      await markNotificationAsNotUseful(id);
      await loadNotifications();
      alert('Success', 'Marked as not useful');
    } catch (error) {
      alert('Error', 'Failed to mark as not useful');
    }
  };

  const handleDelete = async (id: number) => {
    alert(
      'Delete Notification',
      'Are you sure you want to delete this notification?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteNotification(id);
              await loadNotifications();
            } catch (error) {
              alert('Error', 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  const handleClearAll = () => {
    alert(
      'Clear All Notifications',
      'Are you sure you want to delete all notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllNotifications();
              await loadNotifications();
              alert('Success', 'All notifications cleared');
            } catch (error) {
              alert('Error', 'Failed to clear notifications');
            }
          },
        },
      ]
    );
  };

  const handleToggleCollection = async (enabled: boolean) => {
    setCollectionEnabled(enabled);
    await setNotificationCollectionEnabled(enabled);

    if (enabled) {
      alert(
        'Collection Enabled',
        'Notifications will now be collected automatically. Make sure to grant notification listener permission in system settings.',
        [{ text: 'OK' }]
      );
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return formatTimestampInTimezone(timestamp);
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

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="mx-4 mt-3">
        <Card>
          <Text className="text-xl font-bold" style={{ color: colors.text }}>
            Notification Collector
          </Text>
          <Text className="text-sm mt-1" style={{ color: colors.textSecondary }}>
            Collect notifications for parser training data
          </Text>
          <View className="flex-row gap-3 mt-4">
            <View className="flex-1 rounded-lg p-3" style={{ backgroundColor: colors.surface }}>
              <Text className="text-2xl font-bold" style={{ color: colors.text }}>{totalCount}</Text>
              <Text className="text-xs" style={{ color: colors.textSecondary }}>Total</Text>
            </View>
            <View className="flex-1 rounded-lg p-3" style={{ backgroundColor: sc.success + '20' }}>
              <Text className="text-2xl font-bold" style={{ color: sc.success }}>{usefulCount}</Text>
              <Text className="text-xs" style={{ color: sc.success }}>Useful</Text>
            </View>
          </View>
        </Card>
      </View>

      {/* Actions */}
      <View className="mx-4 mt-3">
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Auto-Collect Notifications
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                Collect all notifications passively
              </Text>
            </View>
            <Switch
              value={collectionEnabled}
              onValueChange={handleToggleCollection}
              trackColor={{ false: colors.border, true: sc.success }}
              thumbColor={collectionEnabled ? sc.success : colors.textSecondary}
            />
          </View>
        </Card>
      </View>

      {notifications.length > 0 && (
        <View className="mx-4 mt-3">
          <Pressable
            onPress={handleClearAll}
            className="flex-row items-center justify-center py-2.5 rounded-lg"
            style={{ backgroundColor: sc.danger }}
          >
            <Ionicons name="trash-outline" size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Clear All</Text>
          </Pressable>
        </View>
      )}

      {/* List */}
      <ScrollView className="flex-1 mt-3">
        {notifications.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20 px-8">
            <Ionicons name="notifications-off-outline" size={64} color={colors.textSecondary} />
            <Text className="text-center mt-4" style={{ color: colors.textSecondary }}>
              No notifications collected yet. Enable auto-collection above and grant notification listener permission in system settings to start collecting data.
            </Text>
            <Text className="text-center mt-4 px-8 text-sm" style={{ color: colors.textSecondary }}>
              After enabling, go to Android Settings → Apps → Artha → Notifications → Notification access and grant permission.
            </Text>
          </View>
        ) : (
          <View className="mx-4 mb-4">
            {notifications.map((notification) => (
              <Card key={notification.id} className="mb-3">
                {/* Header */}
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 mb-1 flex-wrap">
                      {notification.is_useful === 1 && (
                        <View className="px-2 py-0.5 rounded" style={{ backgroundColor: sc.success + '20' }}>
                          <Text className="text-xs font-semibold" style={{ color: sc.success }}>USEFUL</Text>
                        </View>
                      )}
                      {notification.app_package && (
                        <Text className="text-xs" style={{ color: colors.textSecondary }}>
                          {notification.app_package}
                        </Text>
                      )}
                    </View>
                    <Text className="text-base font-semibold" style={{ color: colors.text }}>
                      {notification.title}
                    </Text>
                  </View>
                  <Text className="text-xs ml-2" style={{ color: colors.textSecondary }}>
                    {formatTimestamp(notification.timestamp)}
                  </Text>
                </View>

                {/* Body */}
                <Text className="text-sm mb-2" style={{ color: colors.text }}>
                  {notification.body}
                </Text>

                {/* Payload */}
                {notification.payload_json && (
                  <View className="rounded p-2 mb-2" style={{ backgroundColor: colors.surface }}>
                    <Text className="text-xs font-mono" style={{ color: colors.textSecondary }}>
                      {notification.payload_json}
                    </Text>
                  </View>
                )}

                {/* Notes */}
                {notification.notes && (
                  <View className="rounded p-2 mb-2" style={{ backgroundColor: sc.warning + '20' }}>
                    <Text className="text-xs" style={{ color: sc.warning }}>
                      Notes: {notification.notes}
                    </Text>
                  </View>
                )}

                {/* Actions */}
                <View className="flex-row gap-2">
                  {notification.is_useful !== 1 ? (
                    <Pressable
                      onPress={() => setSelectedId(notification.id || null)}
                      className="flex-1 rounded-lg py-2 flex-row items-center justify-center"
                      style={{ backgroundColor: sc.success }}
                    >
                      <Ionicons name="checkmark" size={16} color="white" />
                      <Text className="text-white text-sm font-semibold ml-1">Mark Useful</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => handleMarkNotUseful(notification.id!)}
                      className="flex-1 rounded-lg py-2 flex-row items-center justify-center"
                      style={{ backgroundColor: colors.textSecondary }}
                    >
                      <Ionicons name="remove" size={16} color="white" />
                      <Text className="text-white text-sm font-semibold ml-1">Unmark</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => handleDelete(notification.id!)}
                    className="rounded-lg py-2 px-3"
                    style={{ backgroundColor: sc.danger }}
                  >
                    <Ionicons name="trash" size={16} color="white" />
                  </Pressable>
                </View>

                {/* Notes input */}
                {selectedId === notification.id && (
                  <View className="mt-2">
                    <TextInput
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Add notes about why this is useful..."
                      className="border rounded-lg p-2 text-sm"
                      style={{ color: colors.text, backgroundColor: colors.background, borderColor: colors.border }}
                      multiline
                    />
                    <View className="flex-row gap-2 mt-2">
                      <Pressable
                        onPress={() => notification.id && handleMarkUseful(notification.id)}
                        className="flex-1 rounded-lg py-2 flex-row items-center justify-center"
                        style={{ backgroundColor: colors.tint }}
                      >
                        <Ionicons name="checkmark" size={16} color="white" />
                        <Text className="text-white text-sm font-semibold ml-1">Save</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setSelectedId(null);
                          setNotes('');
                        }}
                        className="flex-1 rounded-lg py-2 items-center justify-center"
                        style={{ backgroundColor: colors.textSecondary }}
                      >
                        <Text className="text-white text-sm font-semibold">Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
