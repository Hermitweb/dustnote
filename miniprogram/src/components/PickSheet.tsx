/**
 * 半屏选择面板(替代 showActionSheet)
 *
 * wx.showActionSheet 的 itemList 硬上限 6 项;模板(7 预设+自定义)与
 * 文件夹列表随时超限。本组件无条目数限制,支持取消按钮与危险项。
 */
import { View, Text, ScrollView } from '@tarojs/components';

export interface PickItem {
  key: string;
  label: string;
  danger?: boolean;
}

export function PickSheet(props: {
  title?: string;
  items: PickItem[];
  onCancel?: () => void;
  cancelText?: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <View className="menu-overlay" onClick={props.onClose}>
      <View className="menu-sheet" onClick={(e) => e.stopPropagation()}>
        {props.title && (
          <Text className="menu-title">{props.title}</Text>
        )}
        <ScrollView scrollY className="menu-scroll" enhanced showScrollbar={false}>
          {props.items.map((it) => (
            <Text
              key={it.key}
              className={`menu-item${it.danger ? ' menu-item-danger' : ''}`}
              onClick={() => props.onPick(it.key)}
            >
              {it.label}
            </Text>
          ))}
        </ScrollView>
        {props.onCancel && (
          <Text
            className="menu-item menu-item-cancel"
            onClick={() => {
              props.onCancel?.();
              props.onClose();
            }}
          >
            {props.cancelText ?? '取消'}
          </Text>
        )}
      </View>
    </View>
  );
}
