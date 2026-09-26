/** @type {import('tailwindcss').Config} */
import { SEMANTIC_COLORS, SEMANTIC_EXTRAS } from '../shared/tailwind-colors.mjs';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
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
