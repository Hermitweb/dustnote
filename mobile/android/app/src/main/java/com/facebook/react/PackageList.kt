package com.facebook.react

import com.facebook.react.ReactPackage
import com.facebook.react.ReactNativeHost
import com.facebook.react.shell.MainReactPackage
import com.reactnativecommunity.asyncstorage.AsyncStoragePackage
import com.rnbiometrics.ReactNativeBiometricsPackage
import com.rnfs.RNFSPackage
import com.oblador.keychain.KeychainPackage
import com.th3rdwave.safeareacontext.SafeAreaContextPackage
import com.swmansion.rnscreens.RNScreensPackage
import org.pgsqlite.SQLitePluginPackage
import com.horcrux.svg.SvgPackage
import com.oblador.vectoricons.VectorIconsPackage
import com.reactnativecommunity.webview.RNCWebViewPackage

class PackageList(private val reactNativeHost: ReactNativeHost) {
  val packages: List<ReactPackage>
    get() = listOf(
      MainReactPackage(),
      AsyncStoragePackage(),
      ReactNativeBiometricsPackage(),
      RNFSPackage(),
      KeychainPackage(),
      SafeAreaContextPackage(),
      RNScreensPackage(),
      SQLitePluginPackage(),
      SvgPackage(),
      VectorIconsPackage(),
      RNCWebViewPackage()
    )
}