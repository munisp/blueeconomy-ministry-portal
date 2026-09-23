import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  build: {
    // Phase 21 perf: never ship sourcemaps in production builds (they leak
    // source and inflate deploy artifacts); dev builds keep them.
    sourcemap: command !== "build",
    target: "es2023",
    // Preload the entry chunk (and its static imports) so the browser
    // fetches the critical path in parallel instead of discovering it
    // waterfall-style.
    modulePreload: { polyfill: true }
    // maplibre-gl is split into its own async chunk automatically via the
    // dynamic import() in src/components/MapPanel.tsx (loaded only when a
    // map page mounts).
  }
}));
