/**
 * 半屏选择面板(替代 showActionSheet)
 *
 * wx.showActionSheet 的 itemList 硬上限 6 项;模板(7 预设+自定义)与
 * 文件夹列表随时超限。本组件无条目数限制,支持取消按钮与危险项、条目图标。
 *
 * 动效：进入 = CSS 挂载动画（menu-overlay/menu-sheet 的 animation）；
 * 退出 = 组件内 closing 状态先播滑出动画,200ms 后再触发 onClose/onPick——
 * 因此 onPick 也会延迟 200ms 触发（选择项点击 → 面板滑下 → 执行动作）,
 * 调用方无需感知;期间 overlay 仍遮挡屏幕,天然防双击重复选择。
 */
import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { Icon, type IconName } from './Icon';

export interface PickItem {
  key: string;
  label: string;
  danger?: boolean;
  icon?: IconName;
}

/** 退出动画时长,与 app.scss 的 .menu-sheet-closing 过渡保持一致 */
const EXIT_MS = 200;

export function PickSheet(props: {
  title?: string;
  items: PickItem[];
  onCancel?: () => void;
  cancelText?: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  /** 播退出动画,结束后再执行真正的关闭/选择动作 */
  const dismiss = (after?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = setTimeout(() => {
      after?.();
      props.onClose();
    }, EXIT_MS);
  };

  return (
    <View
      className={`menu-overlay${closing ? ' menu-overlay-closing' : ''}`}
      onClick={() => {
        props.onCancel?.();
        dismiss();
      }}
    >
      <View
        className={`menu-sheet${closing ? ' menu-sheet-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {props.title && <Text className="menu-title">{props.title}</Text>}
        <ScrollView scrollY className="menu-scroll" enhanced showScrollbar={false}>
          {props.items.map((it) => (
            <Text
              key={it.key}
              className={`menu-item${it.danger ? ' menu-item-danger' : ''}`}
              onClick={() => dismiss(() => props.onPick(it.key))}
            >
              <View className="menu-item-row">
                {it.icon && (
                  <Icon name={it.icon} size={20} color={it.danger ? '#E07B6C' : undefined} />
                )}
                <Text className="menu-item-label">{it.label}</Text>
              </View>
            </Text>
          ))}
        </ScrollView>
        {/* F12：取消按钮**无条件渲染**——onClose 是必填 prop,此前写成
            `onCancel || onClose` 的条件恒真（误导）;而更早的版本只在传
            onCancel 时渲染,所有调用方都只传 cancelText,按钮从未出现过。
            onCancel 为兼容保留:存在时先调它再 onClose（当前无调用方使用） */}
        <Text className="menu-item menu-item-cancel" onClick={() => dismiss()}>
          {props.cancelText ?? '取消'}
        </Text>
      </View>
    </View>
  );
}
