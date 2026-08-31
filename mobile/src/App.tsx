/**
 * DustNote Mobile 主入口（v2.0.0 双模式架构）
 *
 * 启动流程：
 * 1. useModeStore.hydrate() 从 AsyncStorage 加载模式状态（已自动执行）
 * 2. useAuthStore.init() 探测当前模式下的鉴权状态
 *    - standalone：检查本地 LocalAuthBlob + lockoutState
 *    - online：调用 /auth/status + 探测 keychain 缓存
 * 3. 根据 modeStore.initialized 决定是否显示 ModeSelectScreen
 * 4. 根据 authState 路由到不同鉴权页面：
 *    - standalone: StandaloneSetupScreen / StandaloneUnlockScreen / StandaloneRecoverScreen
 *    - online: SetupScreen / UnlockScreen
 * 5. 解锁后路由到主界面（NotesListScreen 等）
 *
 * React Navigation 6 + Stack Navigator
 */

import React, { useEffect, useRef } from 'react';
import { StatusBar, View, Text, ActivityIndicator, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import './lib/i18n'; // 副作用导入：初始化 i18next + 加载 AsyncStorage 语言偏好
import { useAuthStore } from './state/auth';
import { useModeStore } from './lib/mode-store';
import { ModeSelectScreen } from './screens/ModeSelectScreen';
import { SetupScreen } from './screens/SetupScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { StandaloneSetupScreen } from './screens/StandaloneSetupScreen';
import { StandaloneUnlockScreen } from './screens/StandaloneUnlockScreen';
import { StandaloneRecoverScreen } from './screens/StandaloneRecoverScreen';
import { NotesListScreen } from './screens/NotesListScreen';
import { NoteEditScreen } from './screens/NoteEditScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { FoldersScreen } from './screens/FoldersScreen';
import { TrashScreen } from './screens/TrashScreen';
import { SharesScreen } from './screens/SharesScreen';
import { OnlineRecoverScreen } from './screens/OnlineRecoverScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConflictDialog } from './components/ConflictDialog';
import { useIsDark, useColors } from './theme';
import { checkUpdateOnce } from './lib/use-update-check';

// ── 加密引擎接入（v2.5.21 起多次迭代）──────────────────────────────
// react-native-quick-crypto 此前仅在 package.json 中声明，JS 侧从未调用
// install()，RN 无 WebCrypto → shared deriveKey 的 hasWebCryptoSubtle()
// 推测失败，一直走 @noble/hashes 纯 JS 回退（PBKDF2 310k 迭代分钟级）——
// 这就是「解锁要几分钟」的真根因。v2.5.23 进一步改为**直连原生绑定**：
// Node 风格 quickCrypto.pbkdf2 不经 globalThis.crypto（install() 是否
// 接管全局取决于其它 polyfill 加载顺序，subtle「存在」≠ 原生——真机
// 曾出现诊断「原生」但派生仍分钟级）。注册结果写入 __QCRYPTO_STATUS。
{
  const status: Record<string, unknown> = {};
  try {
    const qc = require('react-native-quick-crypto');
    status.requireOk = true;
    try {
      qc.install();
      status.installOk = !!(globalThis.crypto as { subtle?: unknown } | undefined)?.subtle;
      if (!status.installOk) {
        status.installError = 'install() did not throw but crypto.subtle is still missing';
      }
      // 原生 PBKDF2 直连：deriveKey 最优先走这里（见 shared setPbkdf2NativeImpl）
      if (typeof qc.pbkdf2 === 'function') {
        const { setPbkdf2NativeImpl } = require('@dustnote/shared') as {
          setPbkdf2NativeImpl: (
            fn: (
              password: string | Uint8Array,
              salt: Uint8Array,
              iterations: number,
              dkLen: number,
            ) => Promise<Uint8Array>,
          ) => void;
        };
        setPbkdf2NativeImpl((password, salt, iterations, dkLen) =>
          new Promise<Uint8Array>((resolve, reject) => {
            qc.pbkdf2(password, salt, iterations, dkLen, 'sha256', (err: Error | null, key: Uint8Array) => {
              if (err) reject(err);
              else resolve(key instanceof Uint8Array ? key : new Uint8Array(key));
            });
          }),
        );
        status.nativePbkdf2 = true;
      } else {
        status.nativePbkdf2 = false;
        status.installError = status.installError ?? 'qc.pbkdf2 is not a function';
      }
    } catch (e) {
      status.installOk = false;
      status.installError = String((e as Error)?.message ?? e);
    }
  } catch (e) {
    status.requireOk = false;
    status.installOk = false;
    status.requireError = String((e as Error)?.message ?? e);
  }
  (globalThis as { __QCRYPTO_STATUS?: Record<string, unknown> }).__QCRYPTO_STATUS = status;
}

// 全局 JS 错误兜底：ErrorBoundary 只覆盖渲染错误，不覆盖异步回调错误。
// 生产环境记录告警日志（内容经 console 过滤，不打印敏感数据），避免崩溃静默。
const ErrorUtilsApi = (
  global as {
    ErrorUtils?: { setGlobalHandler: (h: (e: unknown, isFatal: boolean) => void) => void };
  }
).ErrorUtils;
if (ErrorUtilsApi) {
  ErrorUtilsApi.setGlobalHandler((err, isFatal) => {
    console.warn(
      '[DustNote] uncaught error:',
      isFatal,
      err instanceof Error ? err.message : String(err)
    );
  });
}

export type RootStackParamList = {
  ModeSelect: undefined;
  Setup: undefined;
  Unlock: undefined;
  StandaloneSetup: undefined;
  StandaloneUnlock: undefined;
  StandaloneRecover: undefined;
  OnlineRecover: undefined;
  NotesList: undefined;
  NoteEdit: { noteId: string };
  Settings: undefined;
  Folders: undefined;
  Trash: undefined;
  Shares: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const isDark = useIsDark();
  const colors = useColors();
  const { t } = useTranslation();
  const authState = useAuthStore((s) => s.authState);
  const init = useAuthStore((s) => s.init);
  const lock = useAuthStore((s) => s.lock);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const hydrated = useModeStore((s) => s.hydrated);

  // 已解锁状态快照：AppState 监听器在闭包中读取，避免 stale closure
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  // 后台自动锁定：App 切到后台/inactive 时立即清空内存中的 masterKey
  // 防止内存抓取 / Recent Apps 预览泄露密钥；下次回前台需重新解锁
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      // 'inactive' iOS 切多任务/控制中心；'background' 完全退到后台
      // Android 通常直接 inactive -> background；仅 'active' 时表示回到前台
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        if (authStateRef.current === 'unlocked') {
          lock();
        }
      }
    });
    return () => subscription.remove();
  }, [lock]);

  // 模式状态加载完成后初始化鉴权（mode 变化时也重新探测）
  useEffect(() => {
    if (hydrated && modeInitialized) {
      let cancelled = false;
      // 5s 超时兜底：init() 若永不返回，强制切到 needs_unlock 让用户看到解锁界面
      const timeout = setTimeout(() => {
        if (!cancelled && useAuthStore.getState().authState === 'unknown') {
          useAuthStore.setState({ authState: 'needs_unlock' });
        }
      }, 5000);
      void init().finally(() => {
        cancelled = true;
        clearTimeout(timeout);
      });
      return () => {
        cancelled = true;
        clearTimeout(timeout);
      };
    }
  }, [hydrated, modeInitialized, mode, init]);

  // 启动后自动检查更新（联机模式，5s 延迟避免阻塞初始化）
  useEffect(() => {
    if (authState !== 'unlocked' || mode !== 'online') return;
    const timer = setTimeout(() => {
      void checkUpdateOnce().then((r) => {
        if (r.status === 'force_update' || r.hasUpdate) {
          // 有更新可用时，SettingsScreen 的 onCheckUpdate 会处理提示
          // 这里仅静默检查，不弹窗打扰用户
        }
      }).catch(() => { /* 静默失败 */ });
    }, 5000);
    return () => clearTimeout(timer);
  }, [authState, mode]);

  const bgColor = colors.bg;
  const cardColor = colors.card;
  const fgColor = colors.fg;
  const borderColor = colors.border;

  // 1. 模式状态未加载完成：显示加载页
  if (!hydrated) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            backgroundColor: bgColor,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ActivityIndicator size="large" color={colors.mint600} />
          <Text style={{ marginTop: 12, color: fgColor, fontSize: 14 }}>{t('app.loading')}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // 2. 首次启动未选择模式：显示模式选择页
  if (!modeInitialized) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bgColor} />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.mint600,
              background: bgColor,
              card: cardColor,
              text: fgColor,
              border: borderColor,
              notification: colors.mint500,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: cardColor },
              headerTitleStyle: { color: fgColor, fontWeight: '700' },
              headerTintColor: colors.mint600,
            }}
          >
            <Stack.Screen
              name="ModeSelect"
              component={ModeSelectScreen}
              options={{ title: t('app.mode_select_title'), headerBackVisible: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  // 3. 已选模式但鉴权状态未知：显示加载页
  if (authState === 'unknown') {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            backgroundColor: bgColor,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ActivityIndicator size="large" color={colors.mint600} />
          <Text style={{ marginTop: 12, color: fgColor, fontSize: 14 }}>
            {t('app.checking_auth')}
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // 4. 已解锁：显示主界面
  if (authState === 'unlocked') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bgColor} />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.mint600,
              background: bgColor,
              card: cardColor,
              text: fgColor,
              border: borderColor,
              notification: colors.mint500,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: cardColor },
              headerTitleStyle: { color: fgColor, fontWeight: '700' },
              headerTintColor: colors.mint600,
            }}
          >
            <Stack.Screen
              name="NotesList"
              component={NotesListScreen}
              options={{ title: t('app.name') }}
            />
            <Stack.Screen
              name="NoteEdit"
              component={NoteEditScreen}
              options={{ title: t('app.editor_title') }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: t('app.settings_title') }}
            />
            <Stack.Screen
              name="Folders"
              component={FoldersScreen}
              options={{ title: t('app.folders_title') }}
            />
            <Stack.Screen
              name="Trash"
              component={TrashScreen}
              options={{ title: t('app.trash_title') }}
            />
            <Stack.Screen name="Shares" component={SharesScreen} options={{ title: t('app.shares_title') }} />
          </Stack.Navigator>
        </NavigationContainer>
        {/* 同步冲突裁决（pendingConflicts 非空时弹出） */}
        <ConflictDialog />
      </SafeAreaProvider>
    );
  }

  // 5. 未解锁：根据模式显示对应鉴权流程
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bgColor} />
      <NavigationContainer
        theme={{
          dark: isDark,
          colors: {
            primary: colors.mint600,
            background: bgColor,
            card: cardColor,
            text: fgColor,
            border: borderColor,
            notification: colors.mint500,
          },
        }}
      >
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: cardColor },
            headerTitleStyle: { color: fgColor, fontWeight: '700' },
            headerTintColor: colors.mint600,
          }}
        >
          {mode === 'standalone' ? (
            <>
              {authState === 'uninitialized' && (
                <Stack.Screen
                  name="StandaloneSetup"
                  component={StandaloneSetupScreen}
                  options={{ title: t('app.setup_title'), headerBackVisible: false }}
                />
              )}
              {authState === 'needs_unlock' && (
                <>
                  <Stack.Screen
                    name="StandaloneUnlock"
                    component={StandaloneUnlockScreen}
                    options={{ title: t('app.name'), headerBackVisible: false }}
                  />
                  <Stack.Screen
                    name="StandaloneRecover"
                    component={StandaloneRecoverScreen}
                    options={{ title: t('app.recover_title') }}
                  />
                </>
              )}
            </>
          ) : (
            <>
              {authState === 'uninitialized' && (
                <Stack.Screen
                  name="Setup"
                  component={SetupScreen}
                  options={{ title: t('app.setup_title'), headerBackVisible: false }}
                />
              )}
              {authState === 'needs_unlock' && (
                <Stack.Screen
                  name="Unlock"
                  component={UnlockScreen}
                  options={{ title: t('app.name'), headerBackVisible: false }}
                />
              )}
              <Stack.Screen
                name="OnlineRecover"
                component={OnlineRecoverScreen}
                options={{ title: t('app.recover_title') }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
