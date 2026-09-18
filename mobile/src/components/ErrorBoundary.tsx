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
 */

import React, { Component, type ReactNode } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  BackHandler,
} from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
  showDetails: boolean;
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
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            flexGrow: 1,
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>⚠️</Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 8,
              color: '#1F2937',
            }}
          >
            DustNote 遇到了问题
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: '#6B7280',
              textAlign: 'center',
              marginBottom: 24,
            }}
          >
            应用已捕获未处理错误。您可以尝试重新加载，或退出后重新打开。
          </Text>

          {this.state.error && (
            <View
              style={{
                backgroundColor: '#FFFFFF',
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: '#FECACA',
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: '#DC2626',
                  fontFamily: 'monospace',
                }}
                numberOfLines={4}
              >
                {/* 生产包只展示通用文案，内部错误细节仅开发模式可见 */}
                {__DEV__ ? this.state.error.message : '应用发生内部错误，请重新加载或重启。'}
              </Text>
            </View>
          )}

          {/* 完整错误详情（堆栈）仅开发模式可展开，避免生产包向用户暴露内部路径/代码位置 */}
          {__DEV__ && this.state.showDetails && this.state.errorInfo && (
            <View
              style={{
                backgroundColor: '#111827',
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                maxHeight: 280,
              }}
            >
              <ScrollView nestedScrollEnabled>
                <Text
                  style={{
                    fontSize: 11,
                    color: '#D1D5DB',
                    fontFamily: 'monospace',
                    lineHeight: 16,
                  }}
                >
                  {this.state.errorInfo}
                </Text>
              </ScrollView>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            <TouchableOpacity
              onPress={this.handleReload}
              style={{
                flex: 1,
                backgroundColor: '#16A34A',
                padding: 14,
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  textAlign: 'center',
                  fontWeight: '600',
                  fontSize: 15,
                }}
              >
                重新加载
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={this.handleExit}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: '#D1D5DB',
                padding: 14,
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  textAlign: 'center',
                  fontWeight: '600',
                  fontSize: 15,
                  color: '#374151',
                }}
              >
                退出应用
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={this.handleToggleDetails}
              style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' }}
            >
              <Text style={{ color: '#6B7280', fontSize: 13, fontWeight: '500' }}>
                {this.state.showDetails ? '收起详情' : '显示详情'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={this.handleCopyLog}
              style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' }}
            >
              <Text style={{ color: '#6B7280', fontSize: 13, fontWeight: '500' }}>输出日志</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    paddingTop: 60, // 状态栏留白（ErrorBoundary 在 SafeAreaProvider 之外，不能用 SafeAreaView）
  },
});
