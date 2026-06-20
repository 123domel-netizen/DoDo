import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
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
        theme_color: "#0b0b0d",
        background_color: "#0b0b0d",
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
