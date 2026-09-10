import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureCollection } from "geojson";
import { referenceGridStyle } from "../src/components/map-style.ts";

test("reference grid style is fully self-contained (no network sources)", () => {
  const style = referenceGridStyle();
  assert.equal(style.version, 8);
  const sourceUrls = JSON.stringify(style.sources);
  assert.ok(!sourceUrls.includes("http"), `style must not reference remote sources: ${sourceUrls}`);
  assert.ok(style.layers.some((layer) => layer.id === "background"));
  // Graticule built from inline GeoJSON only.
  const graticule = style.sources.graticule as { type: string; data: FeatureCollection };
  assert.equal(graticule.type, "geojson");
  assert.ok(graticule.data.features.length > 0);
});

test("reference grid covers the full world extent in both axes", () => {
  const style = referenceGridStyle();
  const graticule = style.sources.graticule as { data: FeatureCollection };
  const lons = graticule.data.features.filter((f) => f.properties?.kind === "lon");
  const lats = graticule.data.features.filter((f) => f.properties?.kind === "lat");
  assert.ok(lons.length >= 30);
  assert.ok(lats.length >= 15);
});
