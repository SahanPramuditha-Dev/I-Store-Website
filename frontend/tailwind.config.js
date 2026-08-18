/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        glass: 'rgba(255,255,255,0.08)',
        brand: {
          DEFAULT: 'var(--brand-primary)',
          hover: 'var(--brand-hover)',
          active: 'var(--brand-active)',
          subtle: 'var(--brand-subtle)',
        },
        surface: {
          DEFAULT: 'var(--surface-card)',
          ground: 'var(--surface-ground)',
          card: 'var(--surface-card)',
          elevated: 'var(--surface-elevated)',
          sidebar: 'var(--surface-sidebar)',
          input: 'var(--surface-input)',
        },
        token: {
          text: {
            primary: 'var(--text-primary)',
            secondary: 'var(--text-secondary)',
            muted: 'var(--text-muted)',
            disabled: 'var(--text-disabled)',
            inverse: 'var(--text-inverse)',
          },
          border: {
            DEFAULT: 'var(--border-default)',
            subtle: 'var(--border-subtle)',
            strong: 'var(--border-strong)',
            focus: 'var(--border-focus)',
          },
        },
        semantic: {
          success: {
            DEFAULT: 'var(--color-success)',
            text: 'var(--color-success-text)',
            bg: 'var(--color-success-bg)',
            border: 'var(--color-success-border)',
          },
          warning: {
            DEFAULT: 'var(--color-warning)',
            text: 'var(--color-warning-text)',
            bg: 'var(--color-warning-bg)',
            border: 'var(--color-warning-border)',
          },
          danger: {
            DEFAULT: 'var(--color-danger)',
            text: 'var(--color-danger-text)',
            bg: 'var(--color-danger-bg)',
            border: 'var(--color-danger-border)',
          },
          info: {
            DEFAULT: 'var(--color-info)',
            text: 'var(--color-info-text)',
            bg: 'var(--color-info-bg)',
            border: 'var(--color-info-border)',
          },
          ai: {
            DEFAULT: 'var(--color-ai)',
            text: 'var(--color-ai-text)',
            bg: 'var(--color-ai-bg)',
            border: 'var(--color-ai-border)',
          },
        },
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
