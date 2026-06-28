# DustNote Android (React Native)

> 基于 React Native 0.74 + Android 的 DustNote 移动端

## 目录结构

```
mobile/
├── android/                    # Android 原生工程
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── java/com/dustnote/
│   │   │   │   ├── MainActivity.kt
│   │   │   │   └── MainApplication.kt
│   │   │   └── res/
│   │   └── build.gradle
│   ├── build.gradle
│   ├── gradle.properties
│   └── settings.gradle
├── src/                        # React Native 应用代码
│   ├── App.tsx
│   ├── api.ts
│   ├── theme.ts
│   ├── state/
│   └── screens/
├── index.js                    # RN 注册入口
├── app.json                    # App 元信息
├── package.json
└── tsconfig.json
```

## 环境要求

- Node.js 18+
- JDK 17
- Android Studio Hedgehog | 2023.1.1+
- Android SDK 34
- Gradle 8.x
- React Native CLI 0.74

## 开发

```bash
# 安装依赖
pnpm install

# 启动 Metro bundler
pnpm start

# 构建并安装到 Android 模拟器/真机
pnpm android

# 构建 Release APK
pnpm build:android
# 产物：android/app/build/outputs/apk/release/app-release.apk

# 构建 AAB（Google Play）
pnpm build:aab
# 产物：android/app/build/outputs/bundle/release/app-release.aab
```

## 平台特性

| 特性 | 实现 |
|------|------|
| 本地数据库 | react-native-sqlite-storage |
| 安全存储 | react-native-keychain（保存 wrappedMasterKey） |
| 生物识别 | react-native-biometrics |
| 文件系统 | react-native-fs（导入 .txt/.md） |
| 导航 | @react-navigation/native |
| 状态 | zustand |
| E2EE 加密 | 复用 @dustnote/shared（Argon2id + AES-256-GCM） |

## 后端 API

开发期使用 `adb reverse tcp:3210 tcp:3210` 将真机 localhost 转发到开发机：

```bash
adb reverse tcp:3210 tcp:3210
pnpm start          # 启动 Metro
# 在另一个终端
pnpm android        # 安装并启动 APP
```

生产环境：把 `mobile/src/api.ts` 中的 `baseUrl` 改为 `https://api.dustnote.app/v1`。

## 注意事项

- **签名**：v1.0 暂用 debug 签名；上架 Google Play 需生成 release 签名（v1.1 集成）
- **图标**：默认 `android/app/src/main/res/` 是占位说明，需准备 1024×1024 PNG 后用 `npx @react-native-community/cli` 生成
- **权限**：`AndroidManifest.xml` 默认申请网络权限和生物识别权限
