import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "0.0.0.0";

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    host: HOST,
    allowedHosts: ["gov-map-playground.landly.co.il"],
    proxy: {
      "/api/govmap": {
        target: "https://www.govmap.gov.il",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/govmap/, ""),
      },
    },
  },
  preview: {
    port: PORT,
    host: true, // Allow access from all network interfaces
    allowedHosts: true, // Allow all hosts (needed for production deployments behind proxies)
  },
});
