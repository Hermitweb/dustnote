/**
 * 聚焦隐藏占位词的 TextInput（对齐小程序端 FInput 标准）
 *
 * RN 原生 placeholder 在「聚焦且未输入」时不消失，这里统一用聚焦态
 * 条件渲染（placeholder 置空）处理，失焦恢复。其余 props 透传原生
 * 组件；外部 onFocus/onBlur 会被合并调用。
 */
import React, { useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';

type FTextInputProps = Omit<TextInputProps, 'placeholder' | 'onFocus' | 'onBlur'> & {
  placeholder?: TextInputProps['placeholder'];
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
};

export function FTextInput({ placeholder, onFocus, onBlur, ...rest }: FTextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...rest}
      placeholder={focused ? '' : placeholder}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
