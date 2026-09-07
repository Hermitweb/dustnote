/**
 * 聚焦隐藏占位词的输入组件
 *
 * Taro 受控 Input/Textarea 的原生 placeholder 在「聚焦且未输入」时不会消失，
 * 这里统一用聚焦态条件渲染（placeholder 置空）处理，失焦恢复。
 * 其余 props 透传原生组件；外部 onFocus/onBlur 会被合并调用。
 */
import { Input, Textarea } from '@tarojs/components';
import type { InputProps, TextareaProps } from '@tarojs/components';
import { useState } from 'react';

type FInputProps = Omit<InputProps, 'placeholder' | 'onFocus' | 'onBlur'> & {
  placeholder?: InputProps['placeholder'];
  onFocus?: InputProps['onFocus'];
  onBlur?: InputProps['onBlur'];
};

export function FInput({ placeholder, onFocus, onBlur, ...rest }: FInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
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

type FTextareaProps = Omit<TextareaProps, 'placeholder' | 'onFocus' | 'onBlur'> & {
  placeholder?: TextareaProps['placeholder'];
  onFocus?: TextareaProps['onFocus'];
  onBlur?: TextareaProps['onBlur'];
};

export function FTextarea({ placeholder, onFocus, onBlur, ...rest }: FTextareaProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Textarea
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
