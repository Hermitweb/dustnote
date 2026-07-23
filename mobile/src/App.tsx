/**
 * DustNote Mobile 主入口
 *
 * 移动端使用 React Navigation 6 + Stack Navigator
 * 关键模块：
 * - SetupScreen：首次创建主密码
 * - UnlockScreen：解锁
 * - NotesListScreen：笔记列表
 * - NoteEditScreen：笔记编辑
 * - SettingsScreen：设置 / 主题 / 数据管理
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from './state/auth';
import { SetupScreen } from './screens/SetupScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { NotesListScreen } from './screens/NotesListScreen';
import { NoteEditScreen } from './screens/NoteEditScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { theme, useIsDark } from './theme';

export type RootStackParamList = {
  Setup: undefined;
  Unlock: undefined;
  NotesList: undefined;
  NoteEdit: { noteId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const isDark = useIsDark();
  const authState = useAuthStore((s) => s.authState);
  const init = useAuthStore((s) => s.init);

  // 启动时初始化鉴权状态（探测服务端 + keychain 缓存）
  useEffect(() => {
    void init();
  }, [init]);

  const bgColor = isDark ? theme.bgDark : theme.bgLight;
  const cardColor = isDark ? theme.cardDark : theme.cardLight;
  const fgColor = isDark ? theme.fgDark : theme.fgLight;
  const borderColor = isDark ? theme.borderDark : theme.borderLight;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bgColor} />
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
          {authState === 'uninitialized' && (
            <Stack.Screen name="Setup" component={SetupScreen} options={{ title: '设置主密码' }} />
          )}
          {authState === 'needs_unlock' && (
            <Stack.Screen name="Unlock" component={UnlockScreen} options={{ title: 'DustNote' }} />
          )}
          {authState === 'unlocked' && (
            <>
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
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
