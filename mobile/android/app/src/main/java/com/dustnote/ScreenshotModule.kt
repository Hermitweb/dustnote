package com.dustnote

import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 截屏开关(security.md §3.6 的用户可配置化):
 *
 * 默认 FLAG_SECURE 屏蔽截屏/录屏(防止笔记内容泄露);设置页开关允许用户
 * 在需要时(如向开发者反馈截图)开放截屏,即时生效,重启后按持久化值恢复。
 */
class ScreenshotModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "DustNoteScreenshot"

  @ReactMethod
  fun setAllowed(allowed: Boolean) {
    // 持久化到 SharedPreferences:MainActivity onCreate 恢复
    ctx.getSharedPreferences(PREFS, 0)
      .edit()
      .putBoolean(KEY_ALLOWED, allowed)
      .apply()
    val activity = currentActivity ?: return
    activity.runOnUiThread {
      if (allowed) {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
  }

  companion object {
    private const val PREFS = "dustnote_prefs"
    private const val KEY_ALLOWED = "allow_screenshot"
  }
}
