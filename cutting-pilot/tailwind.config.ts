import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "var(--surface, #ffffff)",
        bg: "var(--bg, #f0f2f5)",
        text: "var(--text, #0f172a)",
        "text-faint": "var(--text-faint, #94a3b8)",
        "text-hint": "var(--text-hint, #64748b)",
        muted: "var(--muted, #64748b)",
        border: "var(--border, #cbd5e1)",
        "border-light": "var(--border-light, #e2e8f0)",
        green: "var(--green, #22c55e)",
        red: "var(--red, #ef4444)",
      },
      fontFamily: {
        sans: ["var(--font)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
