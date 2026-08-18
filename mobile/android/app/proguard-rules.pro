# DustNote ProGuard 规则
#
# 当前 release 构建未启用混淆（enableProguardInReleaseBuilds=false），
# 但 build.gradle 已引用此文件。若未来启用混淆/R8 代码缩减，
# 以下 keep 规则可防止关键类被混淆导致运行时 ClassNotFoundException。

# ============================================================================
# React Native 核心
# ============================================================================

# React Native 主入口（被 JS 通过 AppRegistry 反射调用）
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.modules.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.soloader.** { *; }

# Hermes 引擎
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.modules.fabric.** { *; }

# JSI / TurboModule 反射调用
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keep class * implements com.facebook.react.turbomodule.core.interfaces.TurboModule { *; }

# 自动生成的 PackageList（autolinking）
-keep class com.facebook.react.PackageList { *; }
-keep class com.dustnote.** { *; }

# ============================================================================
# 第三方原生模块（autolinked）
# ============================================================================

# react-native-keychain / biometrics
-keep class com.oblador.keychain.** { *; }
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# react-native-safe-area-context
-keep class com.th3rdwave.safeareacontext.** { *; }

# react-native-fs
-keep class com.rnfs.** { *; }

# react-native-quick-crypto（JSI 绑定）
-keep class com.margelo.** { *; }
-keep class com.swmansion.** { *; }

# @react-native-async-storage/async-storage
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# react-native-gesture-handler
-keep class com.swmansion.gesturehandler.** { *; }

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }

# react-native-screens
-keep class com.swmansion.rnscreens.** { *; }

# react-native-svg
-keep class com.horcrux.svg.** { *; }

# @react-navigation
-keep class com.reactnavigation.** { *; }

# ============================================================================
# 通用保护
# ============================================================================

# 保留所有 JSI 绑定的原生方法（C++ 通过 JNI 反射调用）
-keepclasseswithmembernames class * {
    native <methods>;
}

# 保留 Parcelable CREATOR 字段
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# 保留 Enum 的 values() 和 valueOf()
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# 保留泛型签名（Gson / Moshi 等 JSON 库需要）
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# 移除 Log 类调用（release 包不输出日志）
-assumeassideeffect class android.util.Log {
    public static *** v(...);
    public static *** d(...);
}
