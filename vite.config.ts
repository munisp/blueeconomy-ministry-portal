import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    target: "es2023"
    // maplibre-gl is split into its own async chunk automatically via the
    // dynamic import() in src/components/MapPanel.tsx (loaded only when a
    // map page mounts).
  }
});
