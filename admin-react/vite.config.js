import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/admin-new/",
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
