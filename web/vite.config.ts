import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    injectRegister: false,
    registerType: "prompt",
    manifestFilename: "manifest.webmanifest",
    scope: "/",
    injectManifest: {
      globPatterns: ["index.html", "assets/**/*.{js,css}", "icons/*.png", "manifest.webmanifest"],
      rollupFormat: "iife",
    },
    devOptions: { enabled: false },
    manifest: false,
    includeManifestIcons: false,
  })],
  test: {
    environment: "node"
  }
});
