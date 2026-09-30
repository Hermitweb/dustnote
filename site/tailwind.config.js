/** @type {import('tailwindcss').Config} */
// 与设计系统同源：语义色 token 全部来自 shared/tailwind-colors.mjs，
// 官网不另立一套色值——否则「官网长这样、产品长那样」会永远扯皮。
import { SEMANTIC_COLORS, SEMANTIC_EXTRAS } from '../shared/tailwind-colors.mjs';

export default {
  content: ['./index.html', './src/**/*.{ts,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: SEMANTIC_COLORS,
      fontFamily: {
        // 不引外部字体：一个 E2EE 产品不该在首屏向第三方发请求。
        // Manrope 装了就用，没装就落到系统字族，不做网络请求。
        sans: [
          'Manrope',
          'Noto Sans SC',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      ...SEMANTIC_EXTRAS,
    },
  },
  plugins: [],
};
