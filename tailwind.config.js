/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          overlay: "rgb(var(--color-surface-overlay) / <alpha-value>)",
        },
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        line: {
          DEFAULT: "rgb(var(--color-line) / <alpha-value>)",
          strong: "rgb(var(--color-line-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          light: "rgb(var(--color-ink-light) / <alpha-value>)",
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          soft: "rgb(var(--color-accent-soft) / <alpha-value>)",
          deep: "rgb(var(--color-accent-deep) / <alpha-value>)",
        },
        thread: {
          DEFAULT: "rgb(var(--color-thread) / <alpha-value>)",
          soft: "rgb(var(--color-thread-soft) / <alpha-value>)",
        },
      },
      boxShadow: {
        pop: "var(--shadow-pop)",
        card: "var(--shadow-card)",
        glow: "var(--shadow-glow)",
      },
      backgroundImage: {
        "accent-grad": "linear-gradient(135deg, #8a83ff 0%, #635bdb 100%)",
      },
    },
  },
  plugins: [],
};
