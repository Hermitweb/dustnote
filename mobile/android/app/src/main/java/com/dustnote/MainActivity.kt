package com.dustnote

import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "DustNote"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // security.md §3.6：默认屏蔽截屏/录屏（FLAG_SECURE）；
    // 用户在设置页开启「允许截屏」后由 ScreenshotModule 持久化，此处按值恢复
    val allowed = getSharedPreferences("dustnote_prefs", 0)
      .getBoolean("allow_screenshot", false)
    if (allowed) {
      window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
