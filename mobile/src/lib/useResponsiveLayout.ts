/**
 * 响应式布局 Hook
 *
 * 根据屏幕宽度判断设备类型，提供平板适配的布局参数。
 * - 手机（< 600dp）：单列布局，紧凑间距
 * - 平板（>= 600dp）：更宽的内容区域，更大的间距
 * - 大平板（>= 840dp）：最大内容宽度限制，类似桌面端
 *
 * 使用 useWindowDimensions 监听屏幕旋转/尺寸变化，自动更新。
 */

import { useWindowDimensions } from 'react-native';

export interface ResponsiveLayout {
  /** 是否为平板设备（宽度 >= 600dp） */
  isTablet: boolean;
  /** 是否为大平板（宽度 >= 840dp） */
  isLargeTablet: boolean;
  /** 列表/内容区域最大宽度（平板上限制内容宽度居中显示） */
  maxContentWidth: number;
  /** 笔记列表项高度（平板上略大） */
  listItemHeight: number;
  /** 卡片内边距 */
  cardPadding: number;
  /** 屏幕水平边距 */
  screenMargin: number;
  /** 是否使用分栏布局（大平板可用 master-detail） */
  useSplitView: boolean;
  /** 标题字号 */
  titleFontSize: number;
  /** 正文字号 */
  bodyFontSize: number;
}

/** 手机默认布局 */
const PHONE_LAYOUT: Omit<ResponsiveLayout, 'isTablet' | 'isLargeTablet'> = {
  maxContentWidth: 0, // 0 = 不限制
  listItemHeight: 72,
  cardPadding: 16,
  screenMargin: 16,
  useSplitView: false,
  titleFontSize: 18,
  bodyFontSize: 14,
};

/** 平板布局（7"+, sw600dp） */
const TABLET_LAYOUT: Omit<ResponsiveLayout, 'isTablet' | 'isLargeTablet'> = {
  maxContentWidth: 720,
  listItemHeight: 80,
  cardPadding: 24,
  screenMargin: 24,
  useSplitView: false,
  titleFontSize: 20,
  bodyFontSize: 16,
};

/** 大平板布局（10"+, sw840dp） */
const LARGE_TABLET_LAYOUT: Omit<ResponsiveLayout, 'isTablet' | 'isLargeTablet'> = {
  maxContentWidth: 960,
  listItemHeight: 84,
  cardPadding: 32,
  screenMargin: 32,
  useSplitView: true,
  titleFontSize: 22,
  bodyFontSize: 16,
};

/**
 * 响应式布局 Hook
 *
 * @example
 * const { isTablet, maxContentWidth, cardPadding } = useResponsiveLayout();
 * return (
 *   <View style={{ padding: cardPadding, maxWidth: maxContentWidth || undefined }}>
 *     ...
 *   </View>
 * );
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width } = useWindowDimensions();

  const isTablet = width >= 600;
  const isLargeTablet = width >= 840;

  const base = isLargeTablet ? LARGE_TABLET_LAYOUT : isTablet ? TABLET_LAYOUT : PHONE_LAYOUT;

  return {
    isTablet,
    isLargeTablet,
    ...base,
  };
}

/**
 * 获取列表/详情页的布局参数
 * 平板上列表区域占 40%，详情区域占 60%（分栏）
 * 手机上列表全屏，详情页覆盖
 */
export function useSplitViewLayout() {
  const { isLargeTablet } = useResponsiveLayout();

  if (!isLargeTablet) {
    return {
      showSplitView: false,
      listWidth: '100%' as const,
      detailWidth: '100%' as const,
    };
  }

  return {
    showSplitView: true,
    listWidth: '40%' as const,
    detailWidth: '60%' as const,
  };
}
