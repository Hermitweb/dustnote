package com.facebook.react

import com.facebook.react.ReactPackage
import com.facebook.react.ReactNativeHost
import com.facebook.react.shell.MainReactPackage

class PackageList(private val reactNativeHost: ReactNativeHost) {
  val packages: List<ReactPackage>
    get() = listOf(
      MainReactPackage()
    )
}