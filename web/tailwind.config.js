/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主题色（与 theme-system.md 对齐；青瓷绿，与小程序端/app.scss 同一色系）
        // 主色（用户指定 #1FFF26 霓虹绿）：600/700 为填充档，深色文字用 text-on-accent；
        // 主色当文字请用 text-mint-600/700（映射到 --mn-accent 的深色档，霓虹原色在白底不可读）
        mint: {
          50: '#f1fff2',
          100: '#e9ffea',
          200: '#c9ffcd',
          300: '#8cff94',
          400: '#4fff58',
          500: '#1fff26',
          600: '#12d91e',
          700: '#0a7a12',
        },
        // 灰阶
        surface: {
          bg: 'rgb(var(--mn-bg) / <alpha-value>)',
          fg: 'rgb(var(--mn-fg) / <alpha-value>)',
          muted: 'rgb(var(--mn-fg-muted) / <alpha-value>)',
          border: 'rgb(var(--mn-border) / <alpha-value>)',
          card: 'rgb(var(--mn-card) / <alpha-value>)',
          accent: 'rgb(var(--mn-accent) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      transitionDuration: {
        250: '250ms',
      },
    },
  },
  plugins: [],
};
