import fs from "fs";
import http from "http";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const portFilePaths = [
  path.resolve(__dirname, ".sdnext.port"),
  path.join(process.env.HOME || "", ".sdnext.port"),
];

function readPortFile(): string | null {
  for (const p of portFilePaths) {
    try {
      const port = fs.readFileSync(p, "utf-8").trim();
      if (port && /^\d+$/.test(port)) return port;
    } catch { /* not found */ }
  }
  return null;
}

function writePortFile(port: string) {
  for (const p of portFilePaths) {
    try { fs.writeFileSync(p, port, "utf-8"); } catch { /* ignore */ }
  }
}

function probePort(port: number, timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/sdapi/v1/cmd-flags`, { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function detectBackendPort(envPort?: string): Promise<string> {
  // 1. Explicit env var — always wins
  if (envPort) return envPort;

  // 2. Port file — trust it even if SD.Next hasn't started yet
  const filePort = readPortFile();
  if (filePort) return filePort;

  // 3. No file exists — probe to discover SD.Next for the first time
  const candidates = [7855, 7860, 7861, 7862, 7863, 7864, 7865];
  const results = await Promise.all(
    candidates.map(async (p) => ({ port: p, alive: await probePort(p) })),
  );
  const found = results.find((r) => r.alive);
  if (found) {
    const port = String(found.port);
    writePortFile(port);
    return port;
  }

  return "7860";
}

const detectedPort = await detectBackendPort(process.env.BACKEND_PORT);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const isVercel = !!process.env.VERCEL;
  const devPort = parseInt(env.DEV_PORT || (isVercel ? "5173" : "5174"), 10);
  const standalone = env.STANDALONE === "true" || isVercel;
  const backendPort = standalone ? "0" : detectedPort;
  const backend = `http://localhost:${backendPort}`;
  if (!standalone) console.log(`\x1b[36m[enso]\x1b[0m SD.Next backend at ${backend}`);

  return {
  base: mode === "production" && !isVercel ? "/enso/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      workbox: {
        // Force new service worker to activate immediately instead of waiting for all tabs to close
        skipWaiting: true,
        clientsClaim: true,
        // Don't precache anything - Vite already content-hashes JS/CSS bundles so the
        // browser cache alone keeps them fresh.  Precaching caused stale index.html to be
        // served from the SW cache on normal refreshes, requiring Shift+Ctrl+R.
        globPatterns: [],
        // Explicitly disable navigateFallback - it requires the URL to be in precache,
        // which conflicts with globPatterns: [].  SPA navigation is handled by the
        // backend serving index.html for /enso/* routes, and the NetworkFirst rule below.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // App shell (index.html) - always check network first so deploys are instant
            urlPattern: /\/(?:enso\/)?(?:index\.html)?$/,
            handler: "NetworkFirst",
            options: { cacheName: "app-shell", expiration: { maxEntries: 1, maxAgeSeconds: 24 * 60 * 60 } },
          },
          {
            // Hashed JS/CSS/wasm assets - immutable, cache-first is safe
            urlPattern: /\/assets\/.*\.(?:js|css|wasm)$/,
            handler: "CacheFirst",
            options: { cacheName: "assets", expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 } },
          },
          {
            // Cache font files
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 } },
          },
        ],
      },
      manifest: {
        name: mode === "production" ? "SD.Next Enso" : "SD.Next Enso Dev",
        short_name: mode === "production" ? "SD.Next Enso" : "SD.Next Enso Dev",
        description: "AI Image & Video Generation",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "any",
        scope: mode === "production" && !isVercel ? "/enso/" : "/",
        start_url: mode === "production" && !isVercel ? "/enso/" : "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: devPort,
    allowedHosts: true,
    proxy: standalone ? undefined : {
      "/sdapi/v2/ws": { target: backend, ws: true, timeout: 5000 },
      "/sdapi/v2/browser/files": { target: backend, ws: true, timeout: 5000 },
      "/sdapi/v2/jobs": { target: backend, ws: true, timeout: 5000 },
      "/sdapi": { target: backend, timeout: 5000 },
      "/internal": { target: backend, timeout: 5000 },
      "/file": { target: backend, timeout: 5000 },
    },
  },
  define: {
    __VERCEL__: JSON.stringify(isVercel),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
};
});
