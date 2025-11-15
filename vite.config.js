import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 4173,
        host: true,
        proxy: {
            "/api/govmap": {
                target: "https://www.govmap.gov.il",
                changeOrigin: true,
                secure: false,
                rewrite: function (path) { return path.replace(/^\/api\/govmap/, ""); },
            },
        },
    },
});
