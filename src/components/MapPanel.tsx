import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { referenceGridStyle } from "./map-style";

/**
 * Lazy, fail-closed MapLibre wrapper. maplibre-gl is a pinned, bundled
 * dependency loaded via dynamic import (own chunk) — never a runtime CDN
 * script. The base style is either the deployment-configured tile source
 * (same-origin path or HTTPS URL from the approved runtime configuration)
 * or a no-network reference-grid style, so the map is CSP-safe and honest
 * when tiles are not provisioned. WebGL absence and style load errors
 * surface as explicit failure states.
 */

/** True when the browser can create a WebGL context at all. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

export type MapPanelState =
  | { kind: "loading" }
  | { kind: "ready"; map: MaplibreMap }
  | { kind: "failed"; reason: string };

interface MapPanelProperties {
  /** HTTPS or same-origin style URL from the approved runtime configuration; undefined → reference grid. */
  styleUrl?: string;
  center: [number, number];
  zoom: number;
  ariaLabel: string;
  /** Called once the map instance exists; return a cleanup invoked on unmount/re-render. */
  onMapReady?: (map: MaplibreMap) => (() => void) | void;
  overlay?: ReactElement;
}

export function MapPanel({ styleUrl, center, zoom, ariaLabel, onMapReady, overlay }: MapPanelProperties) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MapPanelState>({ kind: "loading" });
  const [tilesConfigured] = useState(styleUrl !== undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    if (!webglAvailable()) {
      setState({ kind: "failed", reason: "WebGL is not available in this browser; the map cannot render." });
      return;
    }
    let disposed = false;
    let map: MaplibreMap | null = null;
    let readyCleanup: (() => void) | void;
    let cancelled = false;

    void (async () => {
      let maplibre: typeof import("maplibre-gl");
      try {
        maplibre = await import("maplibre-gl");
      } catch (error) {
        if (!disposed) {
          setState({ kind: "failed", reason: `map engine failed to load: ${error instanceof Error ? error.message : "unknown error"}` });
        }
        return;
      }
      if (disposed) {
        return;
      }
      try {
        const style: StyleSpecification | string = styleUrl ?? referenceGridStyle();
        map = new maplibre.Map({
          container,
          style,
          center,
          zoom,
          attributionControl: false,
          refreshExpiredTiles: false,
          trackResize: true,
        });
        map.on("error", (event) => {
          // Tile/style fetch failures must not leave a silent blank canvas.
          const message = event.error instanceof Error ? event.error.message : "map resource failed to load";
          if (!cancelled) {
            setState((current) => (current.kind === "ready" ? current : { kind: "failed", reason: message }));
          }
        });
        map.on("load", () => {
          if (disposed || map === null) {
            return;
          }
          readyCleanup = onMapReady?.(map);
          setState({ kind: "ready", map });
        });
      } catch (error) {
        if (!disposed) {
          setState({ kind: "failed", reason: error instanceof Error ? error.message : "map initialisation failed" });
        }
      }
    })();

    return () => {
      disposed = true;
      cancelled = true;
      if (typeof readyCleanup === "function") {
        readyCleanup();
      }
      map?.remove();
    };
  }, [styleUrl]);

  return (
    <div className="map-panel">
      <div ref={containerRef} className="map-panel__canvas" role="application" aria-label={ariaLabel} />
      {state.kind === "loading" && (
        <p className="map-panel__notice" aria-live="polite">Loading map engine…</p>
      )}
      {state.kind === "failed" && (
        <div className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Map unavailable</p>
          <p>{state.reason}</p>
          <p>Tabular data below remains authoritative and continues to update.</p>
        </div>
      )}
      {!tilesConfigured && state.kind === "ready" && (
        <p className="map-panel__notice map-panel__notice--info">
          Base-map tiles are not configured for this deployment; positions are drawn over a reference grid.
        </p>
      )}
      {overlay}
    </div>
  );
}
