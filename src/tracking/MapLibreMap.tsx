// MapLibreMap is the 2D FALLBACK engine for the tracking console (decision
// D5): MapLibre GL (BSD-3-Clause), auto-selected when WebGL2 is unavailable
// or chosen by the operator. It renders the identical truth as the Cesium
// engine from the same render-gated tile template (D8) — the base map is a
// plain raster source with no glyph/sprite dependencies, so it works fully
// offline against a sovereign tile endpoint.
import { useEffect, useRef } from "react";
import { Map as MaplibreMapInstance, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoZone, SOSAlert, VesselSummary } from "./geo-model";
import { isStalePosition, isUnmatchedTrack, vesselKey, vesselLatitude, vesselLongitude } from "./geo-model";
import { SOS_COLOR, STALE_OPACITY, TRACK_COLOR, ZONE_FILL_COLOR, ZONE_OUTLINE_COLOR, vesselColorHex } from "./map-style";
import type { TrackingMapProperties } from "./CesiumMap";

const NIGERIA_INITIAL_CENTER: [number, number] = [4.0, 6.5];
const NIGERIA_INITIAL_ZOOM = 4.6;

const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

function vesselsFeatureCollection(vessels: VesselSummary[], nowMs: number, selectedKey: string | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vessels.map((vessel) => {
      const key = vesselKey(vessel);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [vesselLongitude(vessel), vesselLatitude(vessel)] },
        properties: {
          key,
          sourceClass: vessel.sourceClass,
          unmatched: isUnmatchedTrack(vessel),
          stale: isStalePosition(vessel, nowMs),
          selected: selectedKey === key,
          color: vesselColorHex(vessel.sourceClass, isUnmatchedTrack(vessel)),
        },
      };
    }),
  };
}

function zonesFeatureCollection(zones: GeoZone[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.flatMap((zone) => {
      if (zone.polygon === null || zone.polygon.length < 4) {
        return [];
      }
      const ring = zone.polygon;
      return [{
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [ring] },
        properties: { zoneId: zone.zoneId, name: zone.name, state: zone.state },
      }];
    }),
  };
}

function sosFeatureCollection(alerts: SOSAlert[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: alerts.map((alert) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [alert.longitudeMicros / 1_000_000, alert.latitudeMicros / 1_000_000] },
      properties: { sosAlertId: alert.sosAlertId, state: alert.state },
    })),
  };
}

function trackFeatureCollection(line: [number, number][] | null): FeatureCollection {
  if (line === null || line.length < 2) {
    return EMPTY_FEATURE_COLLECTION;
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} }],
  };
}

export function MapLibreMap(properties: TrackingMapProperties) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMapInstance | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(properties.onSelectVessel);
  onSelectRef.current = properties.onSelectVessel;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let map: MaplibreMapInstance;
    try {
      map = new MaplibreMapInstance({
      container,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tiles: [properties.tileUrl],
            tileSize: 256,
            ...(properties.tileAttribution === undefined ? {} : { attribution: properties.tileAttribution }),
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#0b2632" } },
          { id: "base", type: "raster", source: "base" },
        ],
      },
      center: NIGERIA_INITIAL_CENTER,
      zoom: NIGERIA_INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    } catch (error) {
      properties.onEngineError?.(`the MapLibre 2D engine could not start (${error instanceof Error ? error.message : "WebGL unavailable"})`);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");

    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addSource("track", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addSource("vessels", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addSource("sos", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": ZONE_FILL_COLOR, "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "zones-outline",
        type: "line",
        source: "zones",
        paint: { "line-color": ZONE_OUTLINE_COLOR, "line-width": 1.6, "line-opacity": 0.65 },
      });
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: { "line-color": TRACK_COLOR, "line-width": 2.6, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "vessels",
        type: "circle",
        source: "vessels",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["case", ["get", "selected"], 8.5, ["get", "unmatched"], 6.5, 5.5],
          "circle-opacity": ["case", ["get", "stale"], STALE_OPACITY, 0.95],
          "circle-stroke-width": ["case", ["get", "unmatched"], 2.2, 1.2],
          "circle-stroke-color": ["case", ["get", "unmatched"], "#9aabb2", "#06202a"],
        },
      });
      map.addLayer({
        id: "sos",
        type: "circle",
        source: "sos",
        paint: {
          "circle-color": SOS_COLOR,
          "circle-radius": 8,
          "circle-opacity": ["case", ["==", ["get", "state"], "RESOLVED"], 0.4, 0.95],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "vessels", (event) => {
        const feature = event.features?.[0];
        const key = feature?.properties?.key;
        onSelectRef.current(typeof key === "string" ? key : null);
      });
      map.on("mouseenter", "vessels", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "vessels", () => {
        map.getCanvas().style.cursor = "";
      });
      readyRef.current = true;
      // Flush the data that arrived before the style finished loading.
      syncSources(map, propertiesRef.current);
    });

    return () => {
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !readyRef.current) {
      return;
    }
    syncSources(map, properties);
  }, [properties.vessels, properties.zones, properties.sosAlerts, properties.trackLine, properties.selectedKey, properties.nowMs]);

  return <div ref={containerRef} className="tracking-map__canvas" data-testid="maplibre-map" />;
}

function syncSources(map: MaplibreMapInstance, properties: TrackingMapProperties): void {
  const vessels = map.getSource<GeoJSONSource>("vessels");
  const zones = map.getSource<GeoJSONSource>("zones");
  const sos = map.getSource<GeoJSONSource>("sos");
  const track = map.getSource<GeoJSONSource>("track");
  vessels?.setData(vesselsFeatureCollection(properties.vessels, properties.nowMs, properties.selectedKey));
  zones?.setData(zonesFeatureCollection(properties.zones));
  sos?.setData(sosFeatureCollection(properties.sosAlerts));
  track?.setData(trackFeatureCollection(properties.trackLine));
}
