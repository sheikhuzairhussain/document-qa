import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		host: "0.0.0.0",
		proxy: {
			"/api": {
				target: "http://backend:8000",
				changeOrigin: true,
			},
			// Aegra (LangGraph Platform-compatible agent server). The browser hits
			// `/aegra/*`; we strip the prefix and forward to the agents container.
			"/aegra": {
				target: "http://agents:2026",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/aegra/, ""),
			},
		},
	},
});
