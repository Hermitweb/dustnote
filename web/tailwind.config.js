/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主题色（与 theme-system.md 对齐；青瓷绿，与小程序端/app.scss 同一色系）
        mint: {
          50: '#f1f9f4',
          100: '#e3f3ea',
          200: '#c2e6d5',
          300: '#8fd3b3',
          400: '#4fbb8d',
          500: '#2fa871',
          600: '#1e8c5c',
          700: '#156b46',
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
