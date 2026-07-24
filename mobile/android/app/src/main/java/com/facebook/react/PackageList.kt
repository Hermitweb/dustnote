package com.facebook.react

import com.facebook.react.ReactPackage
import android.app.Application
import java.util.Arrays

class PackageList(private val reactNativeHost: ReactNativeHost) {
    val packages: List<ReactPackage>
        get() = Arrays.asList<ReactPackage>(
            MainReactPackage(),
            com.horcrux.svg.SvgPackage(),
            com.reactnativecommunity.webview.RNCWebViewPackage(),
            com.oblador.keychain.KeychainPackage(),
            com.rnfs.RNFSPackage(),
            com.th3rdwave.safeareacontext.SafeAreaContextPackage(),
            com.swmansion.rnscreens.RNScreensPackage(),
            com.reactnativecommunity.asyncstorage.AsyncStoragePackage(),
            com.oblador.vectoricons.VectorIconsPackage(),
            com.reactnativecommunity.biometrics.ReactNativeBiometricsPackage(),
            org.pgsqlite.SQLitePluginPackage()
        )
}
