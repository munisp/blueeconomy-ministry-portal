import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Cesium is served self-hosted and ion-free (geospatial decision D5): the
// build copies the Apache-2.0 cesium npm package's runtime assets (workers,
// widgets, third-party, assets) into /cesium so the deployed portal never
// contacts cesium.com or Cesium ion. CESIUM_BASE_URL is baked at build time;
// the default same-origin path keeps the portal renderable fully offline or
// pointed at sovereign internal endpoints (decision D8 render-gating).
const cesiumBaseUrl = process.env.CESIUM_BASE_URL ?? "/cesium/";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesium", rename: { stripBase: 4 } },
        { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesium", rename: { stripBase: 4 } },
        { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesium", rename: { stripBase: 4 } },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium", rename: { stripBase: 4 } },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
  },
  build: {
    // Production images must not ship full JavaScript sourcemaps; the build
    // stays debuggable via the committed sources, not the deployed artifact.
    sourcemap: false,
    target: "es2023",
  },
});
