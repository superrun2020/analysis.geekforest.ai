import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const oaBaseUrl = (env.VITE_OA_API_BASE_URL || env.NEXT_PUBLIC_OA_API_BASE_URL || "https://oa.geekforest.ai").replace(/\/$/, "");

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 3020,
      watch: isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : undefined,
      proxy: {
        "/api/auth": {
          target: oaBaseUrl,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 3020,
    },
  };
});
