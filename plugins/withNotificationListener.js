const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin to add NotificationListenerService for passive notification collection
 * This allows Artha to capture all system notifications without requiring user interaction
 */
const withNotificationListener = (config) => {
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;

    // Add BIND_NOTIFICATION_LISTENER_SERVICE permission
    androidManifest.manifest.$['android:sharedUserId'] = '${applicationId}';
    
    // Ensure permissions array exists
    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }

    // Add the notification listener permission
    const permissions = androidManifest.manifest['uses-permission'];
    const hasPermission = permissions.some(
      (p) => p.$['android:name'] === 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE'
    );

    if (!hasPermission) {
      permissions.push({
        $: {
          'android:name': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
      });
    }

    // Add the service to application
    if (!androidManifest.manifest.application) {
      androidManifest.manifest.application = [];
    }

    const application = androidManifest.manifest.application[0];
    if (!application.service) {
      application.service = [];
    }

    const services = application.service;
    const hasService = services.some(
      (s) => s.$['android:name'] === '.NotificationListenerService'
    );

    if (!hasService) {
      services.push({
        $: {
          'android:name': '.NotificationListenerService',
          'android:enabled': 'true',
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    return config;
  });

  // Create the NotificationListenerService.kt file
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const { platformProjectRoot } = modConfig.modRequest;
      const serviceDir = path.join(platformProjectRoot, 'app/src/main/java/com/souravbaid/artha');
      
      if (!fs.existsSync(serviceDir)) {
        fs.mkdirSync(serviceDir, { recursive: true });
      }

      const serviceFile = path.join(serviceDir, 'NotificationListenerService.kt');
      const serviceContent = `package com.souravbaid.artha

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NotificationListenerService : NotificationListenerService() {
    companion object {
        private const val TAG = "NotificationListener"
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        sbn?.let { 
            Log.d(TAG, "Notification posted: \${sbn.packageName}")
            sendToReactNative(it, "notification_posted") 
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        sbn?.let { 
            Log.d(TAG, "Notification removed: \${sbn.packageName}")
            sendToReactNative(it, "notification_removed") 
        }
    }

    private fun sendToReactNative(sbn: StatusBarNotification, eventType: String) {
        try {
            val notification = sbn.notification
            val extras = notification.extras
            val title = extras.getCharSequence("android.title")?.toString() ?: ""
            val body = extras.getCharSequence("android.text")?.toString() ?: ""
            val packageName = sbn.packageName
            val timestamp = sbn.postTime

            Log.d(TAG, "Sending to React Native: title=\$title, packageName=\$packageName")

            val payload = Arguments.createMap().apply {
                putString("eventType", eventType)
                putString("title", title)
                putString("body", body)
                putString("packageName", packageName)
                putDouble("timestamp", timestamp.toDouble())
                
                // Add all extras as JSON string
                val extrasMap = Arguments.createMap()
                val keys = extras.keySet()
                for (key in keys) {
                    val value = extras.get(key)
                    when (value) {
                        is String -> extrasMap.putString(key, value)
                        is Number -> extrasMap.putDouble(key, value.toDouble())
                        is Boolean -> extrasMap.putBoolean(key, value)
                        is CharSequence -> extrasMap.putString(key, value.toString())
                        else -> extrasMap.putString(key, value?.toString() ?: "")
                    }
                }
                putMap("data", extrasMap)
            }

            val reactContext = (application as ReactApplication).reactNativeHost.reactInstanceManager.currentReactContext
            if (reactContext != null) {
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("NotificationListenerEvent", payload)
                Log.d(TAG, "Event emitted successfully")
            } else {
                Log.w(TAG, "React Native context is null, cannot emit event")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error sending notification to React Native", e)
        }
    }
}
`;

      fs.writeFileSync(serviceFile, serviceContent);
      return modConfig;
    },
  ]);

  return config;
};

module.exports = withNotificationListener;
