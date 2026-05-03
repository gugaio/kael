import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        kael: {
          bg: "#f5f7fb",
          panel: "#ffffff",
          panelSoft: "#f7f9fc",
          border: "#d8e0eb",
          accent: "#2563eb",
          warm: "#d97706",
          danger: "#dc2626",
          text: "#132033",
          muted: "#5f7188",
        },
      },
      boxShadow: {
        glow: "0 20px 45px rgba(15, 23, 42, 0.08)",
        shell: "0 24px 60px rgba(15, 23, 42, 0.08)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Segoe UI", "Helvetica Neue", "sans-serif"],
        reading: ["Source Sans 3", "Segoe UI", "Helvetica Neue", "sans-serif"],
        mono: ["IBM Plex Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
