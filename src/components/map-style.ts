import type { StyleSpecification } from "maplibre-gl";
import type { Feature } from "geojson";

/**
 * No-network fallback style: background + graticule grid, zero external
 * requests. Pure module (no CSS imports) so it is unit-testable under
 * node --test.
 */
export function referenceGridStyle(): StyleSpecification {
  const graticuleFeatures: Feature[] = [];
  for (let lon = -180; lon <= 180; lon += 10) {
    graticuleFeatures.push({
      type: "Feature",
      properties: { kind: "lon" } as Record<string, unknown>,
      geometry: { type: "LineString", coordinates: [[lon, -85], [lon, 85]] },
    });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    graticuleFeatures.push({
      type: "Feature",
      properties: { kind: "lat" } as Record<string, unknown>,
      geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return {
    version: 8,
    name: "reference-grid",
    sources: {
      graticule: { type: "geojson", data: { type: "FeatureCollection", features: graticuleFeatures } },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0b1d2a" } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": "#1d3a4f", "line-width": 1 },
      },
    ],
  };
}
