import fs from "fs";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Read the port SD.Next wrote on last startup (falls back to 7860)
let sdnextPort = "7860";
try {
  sdnextPort = fs.readFileSync(path.resolve(__dirname, ".sdnext.port"), "utf-8").trim();
} catch { /* .sdnext.port not found, use default */ }

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const isVercel = !!process.env.VERCEL;
  const devPort = parseInt(env.DEV_PORT || (isVercel ? "5173" : "5174"), 10);
  const backendPort = env.BACKEND_PORT || sdnextPort;
  const standalone = env.STANDALONE === "true" || backendPort === "0" || isVercel;
  const backend = `http://localhost:${backendPort}`;

  return {
  base: mode === "production" && !isVercel ? "/enso/" : "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
        type: "module",
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
      "/sdapi/v2/ws": { target: backend, ws: true },
      "/sdapi/v2/browser/files": { target: backend, ws: true },
      "/sdapi/v2/jobs": { target: backend, ws: true },
      "/sdapi": backend,
      "/internal": backend,
      "/file": backend,
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
