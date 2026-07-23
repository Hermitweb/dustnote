# DustNote 主题系统设计规范

> 文档版本：v1.0.0
> 适用产品：DustNote · 尘心笔记
> 目标读者：设计 / 前端

---

## 1. 设计目标

1. **完善的色彩体系**：覆盖全天使用场景的 6 套主题 × 2 种模式 = 12 套皮肤
2. **可访问性优先**：所有主题对比度通过 WCAG AA（正文 ≥ 4.5:1，大字 ≥ 3:1）
3. **可扩展性**：新增主题只需新增一个 JSON 文件，无需改代码
4. **平滑切换**：所有切换均带 300ms ease-out 渐变过渡
5. **跨端一致**：Web / 桌面 / 移动 / 小程序四端使用同一套 token 定义

---

## 2. 主题总览

| ID            | 中文名   | 主色      | 风格定位 | 推荐场景             |
| ------------- | -------- | --------- | -------- | -------------------- |
| `mint-dawn`   | 薄荷晨光 | `#A8E6CF` | 清爽自然 | 白天写作、灵感速记   |
| `mist-blue`   | 雾霭蓝调 | `#B5D8E8` | 安静理性 | 长时间阅读、深度思考 |
| `forest-dusk` | 暮色森林 | `#7FB69E` | 沉稳内敛 | 夜间专注             |
| `caramel`     | 焦糖暖光 | `#FFD9A6` | 温暖治愈 | 秋冬、回忆类内容     |
| `sakura`      | 樱粉物语 | `#FFD3DC` | 柔和浪漫 | 个人日记、情感类     |
| `paper`       | 极简白   | `#F5F5F0` | 纯粹极简 | 文档型笔记           |

> 每套主题提供 `light`（亮）和 `dark`（暗）两种变体。

---

## 3. 主题 Token 体系

所有主题通过 CSS 变量（Web / 桌面）与设计 Token（移动 / 小程序）双层映射。

### 3.1 颜色 Token

| Token                    | 用途            | 浅色示例（薄荷晨光） | 深色示例（薄荷晨光） |
| ------------------------ | --------------- | -------------------- | -------------------- |
| `--color-bg`             | 页面主背景      | `#FAFCF9`            | `#0F1714`            |
| `--color-bg-elevated`    | 卡片 / 弹层背景 | `#FFFFFF`            | `#172420`            |
| `--color-bg-sunken`      | 输入框 / 凹陷区 | `#F1F6F2`            | `#0A1311`            |
| `--color-text`           | 主文字          | `#1F2D26`            | `#E8F0EA`            |
| `--color-text-secondary` | 次要文字        | `#5C6B63`            | `#9CA8A2`            |
| `--color-text-muted`     | 辅助文字        | `#8B9690`            | `#6A7670`            |
| `--color-border`         | 描边            | `#E3EBE6`            | `#26302C`            |
| `--color-primary`        | 主题主色        | `#4FB783`            | `#7CD4A8`            |
| `--color-primary-hover`  | 主色悬浮        | `#3E9C6A`            | `#92DEB7`            |
| `--color-primary-soft`   | 主色淡化        | `#E8F5EE`            | `#1F3329`            |
| `--color-accent`         | 强调色          | `#F5A65B`            | `#F5B97D`            |
| `--color-success`        | 成功            | `#4FB783`            | `#7CD4A8`            |
| `--color-warning`        | 警告            | `#E8B86B`            | `#E8C788`            |
| `--color-danger`         | 危险            | `#E07B6C`            | `#E89A8E`            |
| `--color-info`           | 信息            | `#6FA8C7`            | `#8FBDD8`            |
| `--color-overlay`        | 模态遮罩        | `rgba(15,23,20,0.4)` | `rgba(0,0,0,0.6)`    |

### 3.2 排版 Token

| Token                       | 用途     | 默认值                                         |
| --------------------------- | -------- | ---------------------------------------------- |
| `--font-family-display`     | 标题字体 | `"Manrope", "Noto Sans SC", system-ui`         |
| `--font-family-body`        | 正文字体 | `"Noto Sans SC", system-ui, sans-serif`        |
| `--font-family-mono`        | 等宽字体 | `"JetBrains Mono", "Cascadia Code", monospace` |
| `--font-size-xs`            | 辅助文字 | 12px                                           |
| `--font-size-sm`            | 次要正文 | 13px                                           |
| `--font-size-base`          | 正文     | 15px                                           |
| `--font-size-lg`            | 强调正文 | 17px                                           |
| `--font-size-xl`            | 小标题   | 20px                                           |
| `--font-size-2xl`           | 标题     | 24px                                           |
| `--font-size-3xl`           | 大标题   | 32px                                           |
| `--line-height-comfortable` | 舒适密度 | 1.75                                           |
| `--line-height-standard`    | 标准密度 | 1.6                                            |
| `--line-height-compact`     | 紧凑密度 | 1.45                                           |

### 3.3 空间 Token

| Token           | 用途     | 默认值 |
| --------------- | -------- | ------ |
| `--space-1`     | 微距     | 4px    |
| `--space-2`     | 小       | 8px    |
| `--space-3`     | 中       | 12px   |
| `--space-4`     | 标准     | 16px   |
| `--space-5`     | 宽松     | 24px   |
| `--space-6`     | 大       | 32px   |
| `--space-8`     | 巨       | 48px   |
| `--radius-sm`   | 小圆角   | 6px    |
| `--radius-md`   | 卡片圆角 | 12px   |
| `--radius-lg`   | 弹层圆角 | 16px   |
| `--radius-pill` | 胶囊     | 999px  |

### 3.4 阴影 Token

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.04);
--shadow-lg: 0 1px 2px rgba(0, 0, 0, 0.04), 0 16px 40px rgba(0, 0, 0, 0.08);
--shadow-focus: 0 0 0 4px var(--color-primary-soft);
```

### 3.5 动效 Token

```css
--duration-fast: 150ms;
--duration-base: 200ms;
--duration-slow: 300ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

---

## 4. 主题文件结构

```typescript
// shared/types/theme.ts
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  author?: string;
  modes: {
    light: ColorTokens;
    dark: ColorTokens;
  };
}

export interface ColorTokens {
  bg: string;
  bgElevated: string;
  bgSunken: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  overlay: string;
}
```

```typescript
// shared/themes/mint-dawn.ts
import { ThemeDefinition } from '../types/theme';

export const mintDawn: ThemeDefinition = {
  id: 'mint-dawn',
  name: '薄荷晨光',
  description: '清新自然，灵感速记的良伴',
  modes: {
    light: {
      bg: '#FAFCF9',
      bgElevated: '#FFFFFF',
      bgSunken: '#F1F6F2',
      text: '#1F2D26',
      textSecondary: '#5C6B63',
      textMuted: '#8B9690',
      border: '#E3EBE6',
      primary: '#4FB783',
      primaryHover: '#3E9C6A',
      primarySoft: '#E8F5EE',
      accent: '#F5A65B',
      success: '#4FB783',
      warning: '#E8B86B',
      danger: '#E07B6C',
      info: '#6FA8C7',
      overlay: 'rgba(15,23,20,0.4)',
    },
    dark: {
      bg: '#0F1714',
      bgElevated: '#172420',
      bgSunken: '#0A1311',
      text: '#E8F0EA',
      textSecondary: '#9CA8A2',
      textMuted: '#6A7670',
      border: '#26302C',
      primary: '#7CD4A8',
      primaryHover: '#92DEB7',
      primarySoft: '#1F3329',
      accent: '#F5B97D',
      success: '#7CD4A8',
      warning: '#E8C788',
      danger: '#E89A8E',
      info: '#8FBDD8',
      overlay: 'rgba(0,0,0,0.6)',
    },
  },
};
```

---

## 5. 主题引擎

### 5.1 跨端统一接口

```typescript
// shared/themes/index.ts
import { mintDawn } from './mint-dawn';
import { mistBlue } from './mist-blue';
import { forestDusk } from './forest-dusk';
import { caramel } from './caramel';
import { sakura } from './sakura';
import { paper } from './paper';

export const themes = [mintDawn, mistBlue, forestDusk, caramel, sakura, paper];

export function applyTheme(themeId: string, mode: 'light' | 'dark' | 'auto') {
  const theme = themes.find((t) => t.id === themeId) ?? mintDawn;
  const resolvedMode = mode === 'auto' ? detectSystemMode() : mode;
  const tokens = theme.modes[resolvedMode];
  injectTokens(tokens);
  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.setAttribute('data-mode', resolvedMode);
}
```

### 5.2 切换过渡

```css
:root {
  transition:
    background-color var(--duration-slow) var(--ease-out),
    color var(--duration-slow) var(--ease-out),
    border-color var(--duration-slow) var(--ease-out);
}
```

切换时使用 `View Transitions API`（支持的浏览器）或 `requestAnimationFrame` 渐变。

### 5.3 偏好持久化

- 存储位置：`preferences` 表 + 客户端本地（双写）
- 字段：`themeId`、`mode`、`font`、`density`
- 跨设备同步：作为 `preferences` 资源进入 sync 流

---

## 6. 主题设置页 UI

### 6.1 布局

```
┌─────────────────────────────────────────────────────┐
│  ← 返回   主题                                       │
├─────────────────────────────────────────────────────┤
│  外观模式：[● 跟随系统] [○ 亮] [○ 暗]                │
│                                                     │
│  主题                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐                    │
│  │ 薄荷晨光 │ │ 雾霭蓝调 │ │ 暮色森林 │               │
│  │  [色块] │ │  [色块] │ │  [色块] │                  │
│  │  ✓ 已选 │ │        │ │        │                  │
│  └────────┘ └────────┘ └────────┘                    │
│  ┌────────┐ ┌────────┐ ┌────────┐                    │
│  │ 焦糖暖光 │ │ 樱粉物语 │ │ 极简白  │                  │
│  └────────┘ └────────┘ └────────┘                    │
│                                                     │
│  字体偏好：[系统默认] [思源黑体] [霞鹜文楷]           │
│  排版密度：[舒适] [标准] [紧凑]                      │
└─────────────────────────────────────────────────────┘
```

### 6.2 主题卡片

- 尺寸：桌面 200×160px，移动 100% 宽度
- 结构：上方大色块（占 60% 高度，渐变）、下方主题名 + 选中态（薄荷绿描边 + 右上角 ✓ 徽标）
- 交互：点击立即应用（带过渡动画）

---

## 7. 新增主题流程

1. 在 `shared/themes/` 新增 `<theme-id>.ts`，按 `ThemeDefinition` 编写
2. 在 `shared/themes/index.ts` 导出并加入 `themes` 数组
3. 提交 PR，附上主题预览截图
4. CI 自动生成主题卡片资源
5. 审核通过后随版本发布

---

## 8. 可访问性自检清单

- [ ] 文本与背景对比度 ≥ 4.5:1（正文）/ 3:1（标题）
- [ ] 不仅依赖颜色传达信息（同时使用图标 + 文案）
- [ ] focus 状态可见（4px primary-soft 光晕）
- [ ] 支持系统级 prefers-reduced-motion
- [ ] 支持 prefers-color-scheme 跟随
