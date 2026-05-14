import { DEFAULT_USER_ID } from '@/constants/app';
import { getDatabase } from '@/database';
import * as Notifications from 'expo-notifications';
import { DeviceEventEmitter, Platform } from 'react-native';

export interface CollectedNotification {
  id?: number;
  user_id: number;
  title: string;
  body: string;
  payload_json?: string;
  app_package?: string;
  timestamp: number;
  is_useful: number;
  notes?: string;
  created_at?: string;
  deleted_at?: string;
}

/**
 * Get the persisted collection enabled state from database
 */
async function getCollectionEnabledState(): Promise<boolean> {
  try {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'notification_collection_enabled' AND user_id = ?`,
      [DEFAULT_USER_ID]
    );
    return result?.value === 'true';
  } catch (error) {
    console.error('Error getting collection enabled state:', error);
    return false;
  }
}

/**
 * Set the persisted collection enabled state in database
 */
async function setCollectionEnabledState(enabled: boolean): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'notification_collection_enabled', ?)`,
      [DEFAULT_USER_ID, enabled ? 'true' : 'false']
    );
  } catch (error) {
    console.error('Error setting collection enabled state:', error);
  }
}

/**
 * Store a notification in the collector table
 */
export async function storeNotification(
  notification: Notifications.Notification
): Promise<void> {
  const db = await getDatabase();
  
  const title = notification.request.content.title || '';
  const body = notification.request.content.body || '';
  const data = notification.request.content.data || {};
  
  const timestamp = Date.now();
  const payloadJson = JSON.stringify(data);
  
  // Try to get app package from data
  const appPackage = (data.appPackage || data.packageName) as string | undefined;
  
  await db.runAsync(
    `INSERT INTO notification_collector 
     (user_id, title, body, payload_json, app_package, timestamp, is_useful) 
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [DEFAULT_USER_ID, title, body, payloadJson, appPackage || null, timestamp]
  );
  
  console.log('Notification stored:', title);
}

/**
 * Store a notification from the Android NotificationListenerService
 */
export async function storeNotificationFromService(data: {
  title: string;
  body: string;
  packageName?: string;
  timestamp?: number;
  eventType?: string;
}): Promise<void> {
  const db = await getDatabase();
  
  const title = data.title || '';
  const body = data.body || '';
  const appPackage = data.packageName;
  const timestamp = data.timestamp || Date.now();
  const payloadJson = JSON.stringify(data);
  
  await db.runAsync(
    `INSERT INTO notification_collector 
     (user_id, title, body, payload_json, app_package, timestamp, is_useful) 
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [DEFAULT_USER_ID, title, body, payloadJson, appPackage || null, timestamp]
  );
  
  console.log('Notification from service stored:', title, 'from:', appPackage);
}

/**
 * Get all collected notifications
 */
export async function getCollectedNotifications(
  includeDeleted = false
): Promise<CollectedNotification[]> {
  const db = await getDatabase();
  
  const query = includeDeleted
    ? `SELECT * FROM notification_collector WHERE user_id = ? ORDER BY timestamp DESC`
    : `SELECT * FROM notification_collector WHERE user_id = ? AND deleted_at IS NULL ORDER BY timestamp DESC`;
  
  const results = await db.getAllAsync<CollectedNotification>(query, [DEFAULT_USER_ID]);
  return results;
}

/**
 * Get useful notifications
 */
export async function getUsefulNotifications(): Promise<CollectedNotification[]> {
  const db = await getDatabase();
  
  const results = await db.getAllAsync<CollectedNotification>(
    `SELECT * FROM notification_collector 
     WHERE user_id = ? AND is_useful = 1 AND deleted_at IS NULL 
     ORDER BY timestamp DESC`,
    [DEFAULT_USER_ID]
  );
  return results;
}

/**
 * Mark a notification as useful
 */
export async function markNotificationAsUseful(id: number, notes?: string): Promise<void> {
  const db = await getDatabase();
  
  if (notes) {
    await db.runAsync(
      `UPDATE notification_collector SET is_useful = 1, notes = ? WHERE id = ?`,
      [notes, id]
    );
  } else {
    await db.runAsync(
      `UPDATE notification_collector SET is_useful = 1 WHERE id = ?`,
      [id]
    );
  }
}

/**
 * Mark a notification as not useful
 */
export async function markNotificationAsNotUseful(id: number): Promise<void> {
  const db = await getDatabase();
  
  await db.runAsync(
    `UPDATE notification_collector SET is_useful = 0 WHERE id = ?`,
    [id]
  );
}

/**
 * Soft delete a notification
 */
export async function deleteNotification(id: number): Promise<void> {
  const db = await getDatabase();
  
  await db.runAsync(
    `UPDATE notification_collector SET deleted_at = datetime('now') WHERE id = ?`,
    [id]
  );
}

/**
 * Permanently delete a notification
 */
export async function hardDeleteNotification(id: number): Promise<void> {
  const db = await getDatabase();
  
  await db.runAsync(
    `DELETE FROM notification_collector WHERE id = ?`,
    [id]
  );
}

/**
 * Get notification count
 */
export async function getNotificationCount(includeDeleted = false): Promise<number> {
  const db = await getDatabase();
  
  const query = includeDeleted
    ? `SELECT COUNT(*) as count FROM notification_collector WHERE user_id = ?`
    : `SELECT COUNT(*) as count FROM notification_collector WHERE user_id = ? AND deleted_at IS NULL`;
  
  const result = await db.getFirstAsync<{ count: number }>(query, [DEFAULT_USER_ID]);
  return result?.count || 0;
}

/**
 * Clear all notifications (soft delete)
 */
export async function clearAllNotifications(): Promise<void> {
  const db = await getDatabase();
  
  await db.runAsync(
    `UPDATE notification_collector SET deleted_at = datetime('now') WHERE user_id = ?`,
    [DEFAULT_USER_ID]
  );
}

/**
 * Set up notification listener
 */
export async function setupNotificationListener(): Promise<() => void> {
  // Load persisted state
  const persistedEnabled = await getCollectionEnabledState();
  isCollectionEnabled = persistedEnabled;
  console.log('Notification collector loaded with enabled state:', persistedEnabled);

  // Configure notification handler
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Listen for notification responses (user tapping on notification)
  const subscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      if (!isCollectionEnabled) return;
      await storeNotification(response.notification);
    }
  );

  // Listen for incoming notifications from Android NotificationListenerService
  let serviceListener: any = null;
  if (Platform.OS === 'android') {
    try {
      serviceListener = DeviceEventEmitter.addListener('NotificationListenerEvent', async (event) => {
        // Check persisted state instead of module variable
        const enabled = await getCollectionEnabledState();
        if (!enabled) {
          console.log('Notification collection disabled, ignoring event');
          return;
        }
        
        console.log('Received notification from service:', event.title, 'from:', event.packageName);
        
        // Store directly from service data
        await storeNotificationFromService({
          title: event.title,
          body: event.body,
          packageName: event.packageName,
          timestamp: event.timestamp ? Math.floor(event.timestamp) : undefined,
          eventType: event.eventType,
        });
      });

      console.log('Notification listener service setup complete');
    } catch (error) {
      console.error('Error setting up notification listener:', error);
    }
  }

  return () => {
    subscription.remove();
    if (serviceListener) {
      serviceListener.remove();
    }
  };
}

/**
 * Enable/disable notification collection
 */
let isCollectionEnabled = false;

export async function setNotificationCollectionEnabled(enabled: boolean): Promise<void> {
  isCollectionEnabled = enabled;
  await setCollectionEnabledState(enabled);
  console.log('Notification collection enabled:', enabled);
}

export async function isNotificationCollectionEnabled(): Promise<boolean> {
  return await getCollectionEnabledState();
}
