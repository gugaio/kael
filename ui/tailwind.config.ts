import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        kael: {
          bg: "#081018",
          panel: "#0f1d2a",
          panelSoft: "#122334",
          border: "#254764",
          accent: "#2dd4bf",
          warm: "#f59e0b",
          danger: "#f97316",
          text: "#e2edf8",
          muted: "#95adc6",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45, 212, 191, 0.25), 0 8px 30px rgba(0, 0, 0, 0.35)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Segoe UI", "Helvetica Neue", "sans-serif"],
        mono: ["IBM Plex Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;

