import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		// The app shell is split from the assistant and PDF vendor chunks below;
		// the assistant runtime chunk is intentionally larger than Vite's default.
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (
						id.includes("node_modules") &&
						(id.includes("/@assistant-ui/") ||
							id.includes("/@langchain/") ||
							id.includes("/assistant-stream/"))
					) {
						return "assistant";
					}
					if (
						id.includes("node_modules") &&
						(id.includes("/react-pdf/") || id.includes("/pdfjs-dist/"))
					) {
						return "pdf";
					}
					return undefined;
				},
			},
		},
	},
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
				target: "http://api:8000",
				changeOrigin: true,
			},
			// Agents (LangGraph Platform-compatible server). The browser hits
			// `/agents/*`; we strip the prefix and forward to the agents container.
			"/agents": {
				target: "http://agents:2026",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/agents/, ""),
			},
		},
	},
});
