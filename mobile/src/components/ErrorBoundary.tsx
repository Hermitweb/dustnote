/**
 * ErrorBoundary — 捕获 React 渲染错误，避免 RN 应用闪退
 *
 * RN 没有 location.reload()，"重新加载"仅重置 ErrorBoundary 内部状态；
 * 严重 native 级错误仍需用户手动杀进程重启。
 *
 * v2.3.5 增强：
 * - 可展开的完整错误详情（错误栈 + 组件栈），便于 adb logcat 外也能就地排查
 * - "退出应用"选项（BackHandler.exitApp），重新加载无效时的兜底
 * - componentDidCatch 同步保存 componentStack，避免异步丢失
 *
 * 本轮（2026-10-03）：崩溃屏此前整块硬编码调色板（#FEF2F2 底 / #16A34A 按钮 /
 * #FFFFFF 字），是 RN 侧最后一处不走主题引擎的屏 —— 深色档下它会给出一屏
 * 白底，且白字压在绿上只有 1.75:1。捕获逻辑仍是 class（getDerivedStateFromError
 * 必须是静态方法），但 UI 拆成函数组件，因此能用 useColors() 与 StatePlate。
 *
 * 文案仍硬编码中文：这层在 i18n Provider 之外（Provider 自己可能就是崩的那一层），
 * 与 web 的 main.tsx 崩溃兜底同一口径。
 */

import React, { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, BackHandler } from 'react-native';
import { StatePlate } from './StatePlate';
import { useColors } from '../theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
  showDetails: boolean;
}

/** 崩溃屏的动作按钮：两档，与 StatePlate 的 plate/card 同一套底色口径 */
function CrashBtn({
  onPress,
  label,
  primary = false,
}: {
  onPress: () => void;
  label: string;
  primary?: boolean;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
        backgroundColor: primary ? c.accentStrong : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: c.border,
      }}
    >
      <Text
        style={{
          textAlign: 'center',
          fontWeight: '600',
          fontSize: 15,
          color: primary ? c.onAccent : c.fg,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** 次级文字按钮（展开详情 / 输出日志）：不抢主动作的视觉重量 */
function CrashLink({ onPress, label }: { onPress: () => void; label: string }) {
  const c = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' }}
    >
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: '500' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function CrashScreen({
  error,
  errorInfo,
  showDetails,
  onReload,
  onExit,
  onToggleDetails,
  onCopyLog,
}: {
  error: Error | null;
  errorInfo: string | null;
  showDetails: boolean;
  onReload: () => void;
  onExit: () => void;
  onToggleDetails: () => void;
  onCopyLog: () => void;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingTop: 60, // 状态栏留白（ErrorBoundary 在 SafeAreaProvider 之外，不能用 SafeAreaView）
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }}>
        <StatePlate
          size="card"
          icon="warning"
          tone="danger"
          title="DustNote 遇到了问题"
          hint="应用已捕获未处理错误。您可以尝试重新加载，或退出后重新打开。"
          detail={
            error ? (
              <Text
                style={{ fontSize: 12, color: c.danger, fontFamily: 'monospace' }}
                numberOfLines={4}
              >
                {/* 生产包只展示通用文案，内部错误细节仅开发模式可见 */}
                {__DEV__ ? error.message : '应用发生内部错误，请重新加载或重启。'}
              </Text>
            ) : null
          }
          actions={
            <>
              <CrashBtn onPress={onReload} label="重新加载" primary />
              <CrashBtn onPress={onExit} label="退出应用" />
            </>
          }
        />

        {/* 完整错误详情（堆栈）仅开发模式可展开，避免生产包向用户暴露内部路径/代码位置 */}
        {__DEV__ && showDetails && errorInfo ? (
          <View
            style={{
              /* 反色块：堆栈要"看起来像终端输出"才不会被当成正文略读。
                 用 fg 作底、bg 作字色，明暗两档都自动成立，不必再硬写 #111827。 */
              backgroundColor: c.fg,
              padding: 12,
              borderRadius: 8,
              marginHorizontal: 24,
              marginTop: 16,
              maxHeight: 280,
            }}
          >
            <ScrollView nestedScrollEnabled>
              <Text
                style={{
                  fontSize: 11,
                  color: c.bg,
                  fontFamily: 'monospace',
                  lineHeight: 16,
                }}
              >
                {errorInfo}
              </Text>
            </ScrollView>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <CrashLink onPress={onToggleDetails} label={showDetails ? '收起详情' : '显示详情'} />
          <CrashLink onPress={onCopyLog} label="输出日志" />
        </View>
      </ScrollView>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    this.setState({
      errorInfo: `${error.stack || error.message}\n\nComponent Stack:\n${info.componentStack}`,
    });
    // eslint-disable-next-line no-console
    console.error('[DustNote ErrorBoundary]', error, info);
  }

  handleReload = (): void => {
    // 重置 ErrorBoundary 状态，尝试重新渲染
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  handleToggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  handleExit = (): void => {
    BackHandler.exitApp();
  };

  handleCopyLog = (): void => {
    const log = this.state.errorInfo ?? this.state.error?.message ?? 'No error info';
    // RN 无内置 Clipboard（@react-native-clipboard 未链接），输出到 console 供 adb logcat 读取
    // eslint-disable-next-line no-console
    console.error('[DustNote Error Log]', log);
    Alert.alert('日志已输出', '错误日志已打印到控制台（adb logcat | grep DustNote 可查看）', [
      { text: '确定' },
    ]);
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <CrashScreen
        error={this.state.error}
        errorInfo={this.state.errorInfo}
        showDetails={this.state.showDetails}
        onReload={this.handleReload}
        onExit={this.handleExit}
        onToggleDetails={this.handleToggleDetails}
        onCopyLog={this.handleCopyLog}
      />
    );
  }
}
