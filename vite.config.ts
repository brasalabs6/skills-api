import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig(({ mode }) => ({ plugins: [react(), ...(mode === "test" ? [] : [cloudflare()])], test: { environment: "node", include: ["tests/**/*.test.ts"] } }));
