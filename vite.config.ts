import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function resolveBuildVersion(): string {
  if (process.env.APP_BUILD_VERSION?.trim()) return process.env.APP_BUILD_VERSION.trim();
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return process.env.npm_package_version ?? "dev";
  }
}

const appBuildVersion = resolveBuildVersion();

export default defineConfig({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(appBuildVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
      manifest: {
        name: "DoDo",
        short_name: "DoDo",
        description: "Kalendarz i zadania — DoDo",
        theme_color: "#100e16",
        background_color: "#100e16",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        ],
      },
      devOptions: {
        // Disabled in dev: a cache-first SW would serve stale assets and hide
        // live changes / break HMR. The SW is still built for production.
        enabled: false,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
