/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主题色（与 theme-system.md 对齐）
        mint: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
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
        '250': '250ms',
      },
    },
  },
  plugins: [],
};
