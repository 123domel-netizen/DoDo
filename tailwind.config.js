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
        // Premium dark palette
        canvas: "#0b0b0d",
        surface: {
          DEFAULT: "#141417",
          raised: "#1b1b20",
          overlay: "#212128",
        },
        line: {
          DEFAULT: "#28282e",
          strong: "#3a3a42",
        },
        ink: {
          DEFAULT: "#ececee",
          light: "#a4a4ad",
          faint: "#6c6c76",
        },
        accent: {
          DEFAULT: "#7c74ff",
          soft: "#9b95ff",
          deep: "#635bdb",
        },
      },
      boxShadow: {
        pop: "0 0 0 1px rgba(255,255,255,0.06), 0 12px 32px rgba(0,0,0,0.55), 0 4px 10px rgba(0,0,0,0.4)",
        card: "0 1px 2px rgba(0,0,0,0.4)",
        glow: "0 0 0 1px rgba(124,116,255,0.4), 0 8px 24px rgba(124,116,255,0.18)",
      },
      backgroundImage: {
        "accent-grad": "linear-gradient(135deg, #8a83ff 0%, #635bdb 100%)",
      },
    },
  },
  plugins: [],
};
