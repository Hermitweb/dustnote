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

import React, { useEffect } from 'react';
import { StatusBar, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import { TagsScreen } from './screens/TagsScreen';
import { TrashScreen } from './screens/TrashScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { theme, useIsDark } from './theme';

export type RootStackParamList = {
  ModeSelect: undefined;
  Setup: undefined;
  Unlock: undefined;
  StandaloneSetup: undefined;
  StandaloneUnlock: undefined;
  StandaloneRecover: undefined;
  NotesList: undefined;
  NoteEdit: { noteId: string };
  Settings: undefined;
  Folders: undefined;
  Tags: undefined;
  Trash: undefined;
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
  const authState = useAuthStore((s) => s.authState);
  const init = useAuthStore((s) => s.init);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const hydrated = useModeStore((s) => s.hydrated);

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

  const bgColor = isDark ? theme.bgDark : theme.bgLight;
  const cardColor = isDark ? theme.cardDark : theme.cardLight;
  const fgColor = isDark ? theme.fgDark : theme.fgLight;
  const borderColor = isDark ? theme.borderDark : theme.borderLight;

  // 1. 模式状态未加载完成：显示加载页
  if (!hydrated) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: bgColor, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.mint600} />
          <Text style={{ marginTop: 12, color: fgColor, fontSize: 14 }}>加载中…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // 2. 首次启动未选择模式：显示模式选择页
  if (!modeInitialized) {
    return (
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={bgColor}
        />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: theme.mint600,
              background: bgColor,
              card: cardColor,
              text: fgColor,
              border: borderColor,
              notification: theme.mint500,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: cardColor },
              headerTitleStyle: { color: fgColor, fontWeight: '700' },
              headerTintColor: theme.mint600,
            }}
          >
            <Stack.Screen
              name="ModeSelect"
              component={ModeSelectScreen}
              options={{ title: '选择使用模式', headerBackVisible: false }}
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
        <View style={{ flex: 1, backgroundColor: bgColor, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.mint600} />
          <Text style={{ marginTop: 12, color: fgColor, fontSize: 14 }}>正在检查鉴权状态…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // 4. 已解锁：显示主界面
  if (authState === 'unlocked') {
    return (
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={bgColor}
        />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: theme.mint600,
              background: bgColor,
              card: cardColor,
              text: fgColor,
              border: borderColor,
              notification: theme.mint500,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: cardColor },
              headerTitleStyle: { color: fgColor, fontWeight: '700' },
              headerTintColor: theme.mint600,
            }}
          >
            <Stack.Screen
              name="NotesList"
              component={NotesListScreen}
              options={{ title: '🌿 DustNote' }}
            />
            <Stack.Screen
              name="NoteEdit"
              component={NoteEditScreen}
              options={{ title: '编辑' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: '设置' }}
            />
            <Stack.Screen
              name="Folders"
              component={FoldersScreen}
              options={{ title: '文件夹' }}
            />
            <Stack.Screen name="Tags" component={TagsScreen} options={{ title: '标签' }} />
            <Stack.Screen name="Trash" component={TrashScreen} options={{ title: '回收站' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  // 5. 未解锁：根据模式显示对应鉴权流程
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={bgColor}
      />
      <NavigationContainer
        theme={{
          dark: isDark,
          colors: {
            primary: theme.mint600,
            background: bgColor,
            card: cardColor,
            text: fgColor,
            border: borderColor,
            notification: theme.mint500,
          },
        }}
      >
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: cardColor },
            headerTitleStyle: { color: fgColor, fontWeight: '700' },
            headerTintColor: theme.mint600,
          }}
        >
          {mode === 'standalone' ? (
            <>
              {authState === 'uninitialized' && (
                <Stack.Screen
                  name="StandaloneSetup"
                  component={StandaloneSetupScreen}
                  options={{ title: '设置主密码', headerBackVisible: false }}
                />
              )}
              {authState === 'needs_unlock' && (
                <>
                  <Stack.Screen
                    name="StandaloneUnlock"
                    component={StandaloneUnlockScreen}
                    options={{ title: 'DustNote', headerBackVisible: false }}
                  />
                  <Stack.Screen
                    name="StandaloneRecover"
                    component={StandaloneRecoverScreen}
                    options={{ title: '恢复密码' }}
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
                  options={{ title: '设置主密码', headerBackVisible: false }}
                />
              )}
              {authState === 'needs_unlock' && (
                <Stack.Screen
                  name="Unlock"
                  component={UnlockScreen}
                  options={{ title: 'DustNote', headerBackVisible: false }}
                />
              )}
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
