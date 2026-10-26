import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Every colour maps to a theme token CSS variable (see src/theme/tokens.ts).
 * `--ls-<token>-rgb` holds "r g b" channels so opacity modifiers work: `bg-primary/10`.
 * Never add raw hex colours here or in components.
 */
const token = (name: string) => `rgb(var(--ls-${name}-rgb) / <alpha-value>)`;

export default {
  darkMode: ['selector', '[data-theme-mode="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        surface2: token('surface-2'),
        border: token('border'),
        text: token('text'),
        'text-muted': token('text-muted'),
        primary: token('primary'),
        'on-primary': token('on-primary'),
        accent: token('accent'),
        profit: token('profit'),
        loss: token('loss'),
        warning: token('warning'),
        info: token('info'),
      },
      borderColor: { DEFAULT: token('border') },
      ringColor: { DEFAULT: token('accent') },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        base: ['14px', '20px'],
        level: ['26px', { lineHeight: '32px', fontWeight: '500' }],
      },
      keyframes: {
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
