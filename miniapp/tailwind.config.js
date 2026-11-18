/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        canvas: {
          950: "#050811",
          900: "#090d16",
          850: "#0d1321",
          800: "#121a2d",
        },
        surface: {
          card: "#131c31",
          elevated: "#19243e",
        },
        brand: {
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
        },
      },
      keyframes: {
        sheetUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "sheet-up": "sheetUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fadeIn 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
