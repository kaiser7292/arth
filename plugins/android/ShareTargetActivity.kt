package com.souravbaid.arth

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Receives things shared to Arth (a payment screenshot or message) and hands them to MainActivity
 * in Arth's own task, then closes. Copied in by plugins/withShareTarget.js on every prebuild.
 *
 * Why not let MainActivity take shares directly: apps like Amazon Pay share "for a result", and
 * Android then starts the target inside the sharing app's task - ignoring singleTask - so a SECOND
 * MainActivity came up while Arth was already open. Its React screen started loading, took the
 * shared picture, and was closed a moment later by expo-share-intent's task check, so the picture
 * never showed in the Arth you were looking at. This activity has no React in it; MainActivity
 * gets the share as a new intent (open) or on create (closed), exactly as before.
 */
class ShareTargetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val incoming = intent
    val forward = Intent(this, MainActivity::class.java).apply {
      action = incoming.action
      type = incoming.type
      incoming.extras?.let { putExtras(it) }
      // The shared picture is readable only through this intent's grant, which ends when this
      // activity finishes: pass it on to MainActivity.
      clipData = incoming.clipData
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
      startActivity(forward)
    } catch (e: Exception) {
      // E.g. the sender gave no read access to pass on. (Android re-attaches the read grant for a
      // shared file by itself, so handing over without it isn't an option.)
      Log.w("ShareTargetActivity", "Couldn't hand the share to Arth", e)
    }
    finish()
  }
}
