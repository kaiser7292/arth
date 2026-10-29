package expo.modules.arthappupdates

import android.os.Build
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Where Arth was installed from (the Play Store, or an APK from GitHub), and for Play installs,
 * Google Play's in-app update: whether Play has a newer version, and its update screen.
 *
 * The check goes through the Play Store app on the phone. Nothing is sent anywhere by Arth.
 */
class ArthAppUpdatesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArthAppUpdates")

    /** The installing app's package: "com.android.vending" for Play, null or another for an APK. */
    Function("installerPackage") {
      val context = appContext.reactContext ?: return@Function null
      val pm = context.packageManager
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          pm.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
          @Suppress("DEPRECATION")
          pm.getInstallerPackageName(context.packageName)
        }
      } catch (e: Exception) {
        null
      }
    }

    /** Play's newer version code, or null when there's none (or Play can't say). */
    AsyncFunction("playUpdate") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      AppUpdateManagerFactory.create(context).appUpdateInfo
        .addOnSuccessListener { info ->
          val available =
            info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
              info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          promise.resolve(if (available && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) info.availableVersionCode() else null)
        }
        .addOnFailureListener { promise.resolve(null) }
    }

    /**
     * Opens Play's update screen: it downloads and installs, then restarts Arth. Resolves true when
     * the screen opened, false when Play no longer has an update to offer.
     */
    AsyncFunction("startPlayUpdate") { promise: Promise ->
      val context = appContext.reactContext
      val activity = appContext.currentActivity
      if (context == null || activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val manager = AppUpdateManagerFactory.create(context)
      manager.appUpdateInfo
        .addOnSuccessListener { info ->
          val available =
            info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
              info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if (!available || !info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
            promise.resolve(false)
            return@addOnSuccessListener
          }
          try {
            manager.startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
            promise.resolve(true)
          } catch (e: Exception) {
            promise.resolve(false)
          }
        }
        .addOnFailureListener { promise.resolve(false) }
    }
  }
}
