/**
 * ErrorBoundary — 捕获 React 渲染错误，避免 RN 应用闪退
 *
 * RN 没有 location.reload()，"重新加载"仅重置 ErrorBoundary 内部状态；
 * 严重 native 级错误仍需用户手动杀进程重启。
 */

import React, { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

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
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyLog = (): void => {
    const log = this.state.errorInfo ?? this.state.error?.message ?? 'No error info';
    // eslint-disable-next-line no-console
    console.log('[DustNote Error Log]', log);
    Alert.alert('日志已输出', '错误日志已打印到控制台（adb logcat 可查看）', [
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
          <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>
            ⚠️
          </Text>
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
                {this.state.error.message}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
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
              onPress={this.handleCopyLog}
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
                复制日志
              </Text>
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
