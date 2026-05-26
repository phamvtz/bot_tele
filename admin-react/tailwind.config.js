  /** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "'Segoe UI'", "sans-serif"],
      },
      animation: {
        "fade-in":  "fadeIn 0.18s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
        "modal-in": "modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1)",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0", transform: "translateY(-6px)" },  "100%": { opacity: "1", transform: "translateY(0)" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" },   "100%": { opacity: "1", transform: "translateY(0)" } },
        modalIn: { "0%": { opacity: "0", transform: "scale(0.96)" },        "100%": { opacity: "1", transform: "scale(1)" } },
      },
      colors: {
        primary: {
          50:  "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#7c3aed",
          600: "#6d28d9",
          700: "#5b21b6",
          800: "#4c1d95",
          900: "#2e1065",
        },
      },
      boxShadow: {
        card:  "0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        modal: "0 20px 60px -12px rgb(0 0 0 / 0.22)",
      },
    },
  },
  plugins: [],
};
