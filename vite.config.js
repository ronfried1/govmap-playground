import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var PORT = Number(process.env.PORT) || 4173;
var HOST = process.env.HOST || "0.0.0.0";
export default defineConfig({
    plugins: [react()],
    server: {
        port: PORT,
        host: HOST,
        proxy: {
            "/api/govmap": {
                target: "https://www.govmap.gov.il",
                changeOrigin: true,
                secure: false,
                rewrite: function (path) { return path.replace(/^\/api\/govmap/, ""); },
            },
        },
    },
    preview: {
        port: PORT,
        host: HOST,
    },
});
