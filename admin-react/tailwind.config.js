/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Instrument Sans", "Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.03em",
        tight: "-0.02em",
        eyebrow: "0.12em",
      },
      animation: {
        "fade-in":  "fadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slideUp 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
        "modal-in": "modalIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-subtle": "pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0", transform: "translateY(-4px)" },  "100%": { opacity: "1", transform: "translateY(0)" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(6px)" },   "100%": { opacity: "1", transform: "translateY(0)" } },
        modalIn: { "0%": { opacity: "0", transform: "scale(0.97)" },       "100%": { opacity: "1", transform: "scale(1)" } },
        pulseSubtle: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
      },
      colors: {
        // Linear & Vercel Deep Slate/Zinc Canvas
        canvas: {
          950: "#020617", // ultra dark base
          900: "#090d16", // primary deep canvas
          850: "#0b0f19", // secondary elevated canvas
          800: "#101626", // tertiary elevation
        },
        surface: {
          dark: "#0f172a",
          card: "#131b2e",
          elevated: "#18223a",
        },
        primary: {
          50:  "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1", // Electric Indigo
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        electric: {
          cyan:   "#38bdf8", // Neon Cyan
          emerald:"#10b981", // Emerald Green
          amber:  "#f59e0b",
          yellow: "#facc15", // Lemon Yellow
          indigo: "#6366f1",
          violet: "#8b5cf6",
          rose:   "#f43f5e",
        },
      },
      boxShadow: {
        // Ultra-subtle borders & top highlight bevel (Linear/Vercel)
        bento: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 1px 3px 0 rgba(0, 0, 0, 0.4)",
        "bento-hover": "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), 0 3px 8px -1px rgba(0, 0, 0, 0.5)",
        card: "inset 0 1px 0 0 rgba(255, 255, 255, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.4)",
        modal: "0 25px 50px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.1)",
        "glow-cyan": "0 0 15px -3px rgba(56, 189, 248, 0.35)",
        "glow-emerald": "0 0 15px -3px rgba(16, 185, 129, 0.35)",
        "glow-indigo": "0 0 15px -3px rgba(99, 102, 241, 0.35)",
      },
    },
  },
  plugins: [],
};
