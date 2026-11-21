import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { charts: ["recharts"], react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
});
