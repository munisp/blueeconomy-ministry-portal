// map-support selects the map engine for the tracking console: the primary
// self-hosted CesiumJS 3D view, or the MapLibre GL 2D fallback when WebGL2
// is unavailable or the operator toggles it (geospatial decision D5: both
// engines share the same render-gated tile endpoints).
export type MapEngine = "cesium3d" | "maplibre2d";

// MapPreference is the operator's choice; "auto" picks Cesium when the
// device supports WebGL2 and MapLibre otherwise.
export type MapPreference = "auto" | MapEngine;

export const MAP_PREFERENCE_STORAGE_KEY = "blueeconomy.tracking.map-preference";

// detectWebGL2 probes the real canvas API; injected for tests.
export function detectWebGL2(createCanvas: () => { getContext(name: string): unknown } = () => document.createElement("canvas")): boolean {
  try {
    return createCanvas().getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

// resolveEngine applies the preference against device capability. Cesium
// 1.144 requires WebGL2; MapLibre GL renders on WebGL(1/2). A device with
// no WebGL at all gets MapLibre, whose own context failure is then surfaced
// as an honest map-unavailable state by the console.
export function resolveEngine(preference: MapPreference, webgl2Available: boolean): MapEngine {
  if (preference === "cesium3d") {
    return webgl2Available ? "cesium3d" : "maplibre2d";
  }
  if (preference === "maplibre2d") {
    return "maplibre2d";
  }
  return webgl2Available ? "cesium3d" : "maplibre2d";
}

export function readMapPreference(storage: Pick<Storage, "getItem"> = window.sessionStorage): MapPreference {
  const raw = storage.getItem(MAP_PREFERENCE_STORAGE_KEY);
  return raw === "cesium3d" || raw === "maplibre2d" ? raw : "auto";
}

export function writeMapPreference(preference: MapPreference, storage: Pick<Storage, "setItem"> = window.sessionStorage): void {
  storage.setItem(MAP_PREFERENCE_STORAGE_KEY, preference);
}
