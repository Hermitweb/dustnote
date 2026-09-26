/** @type {import('tailwindcss').Config} */
import { SEMANTIC_COLORS, SEMANTIC_EXTRAS } from '../shared/tailwind-colors.mjs';

export default {
  // 桌面端复用 web 端组件，扫描路径需包含 web/src 才能提取完整类名
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../web/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // 与 web 端同一份语义色表：desktop 渲染的是 web 的组件，两边不可能允许两套色名
      colors: SEMANTIC_COLORS,
      fontFamily: {
        sans: ['Manrope', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      ...SEMANTIC_EXTRAS,
    },
  },
  plugins: [],
};
