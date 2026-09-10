import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { MapPanel } from "../components/MapPanel";
import { useTranslation } from "../i18n";
import {
  GeoApiError,
  VESSEL_POLL_INTERVAL_MS,
  fetchVesselsInBbox,
  isObservationStale,
  type Bbox,
  type GeoVessel,
} from "../geo-client";
import type { DashboardPageProps } from "./props";

interface VesselFeedState {
  vessels: GeoVessel[];
  staleCount: number;
  updatedAt: string | null;
  error: string | null;
  polling: boolean;
}

const INITIAL_FEED: VesselFeedState = { vessels: [], staleCount: 0, updatedAt: null, error: null, polling: false };

function mapBoundsToBbox(map: MaplibreMap): Bbox {
  const bounds = map.getBounds();
  return {
    minLon: Math.max(-180, bounds.getWest()),
    minLat: Math.max(-85, bounds.getSouth()),
    maxLon: Math.min(180, bounds.getEast()),
    maxLat: Math.min(85, bounds.getNorth()),
  };
}

/**
 * Congestion / throughput heatmap (#4): viewport-driven polling of the real
 * geo-service vessel bbox feed rendered as a MapLibre heatmap layer, with
 * explicit stale-data indicators. Fail-closed: an unconfigured geo-service
 * or an unreachable backend renders an explicit state, never demo data.
 */
export function GeoHeatmapPage({ geoBaseUrl, token, tileStyleUrl, defaultBbox }: DashboardPageProps) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<VesselFeedState>(INITIAL_FEED);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(0);

  const poll = useCallback(async () => {
    if (geoBaseUrl === null || token === null || mapRef.current === null) {
      return;
    }
    setFeed((current) => ({ ...current, polling: true }));
    try {
      const bbox = mapBoundsToBbox(mapRef.current);
      const result = await fetchVesselsInBbox(geoBaseUrl, token, bbox);
      const nowMs = Date.now();
      setFeed({
        vessels: result.vessels,
        staleCount: result.vessels.filter((vessel) => isObservationStale(vessel.observedAt, nowMs)).length,
        updatedAt: new Date(nowMs).toISOString(),
        error: null,
        polling: false,
      });
    } catch (error) {
      const message =
        error instanceof GeoApiError && error.status === 403
          ? "The geo-service refused the request (HTTP 403): your session lacks a geo-reader role or sufficient clearance."
          : error instanceof Error
            ? error.message
            : "vessel feed request failed";
      setFeed((current) => ({ ...current, error: message, polling: false }));
    }
  }, [geoBaseUrl, token]);

  // Poll on an interval once the map exists; re-poll after viewport moves settle.
  useEffect(() => {
    if (geoBaseUrl === null || token === null || mapRef.current === null) {
      return;
    }
    void poll();
    const interval = setInterval(() => void poll(), VESSEL_POLL_INTERVAL_MS);
    const map = mapRef.current;
    const onMoveEnd = () => void poll();
    map.on("moveend", onMoveEnd);
    return () => {
      clearInterval(interval);
      map.off("moveend", onMoveEnd);
    };
  }, [poll, mapReady, geoBaseUrl, token]);

  // Push vessel positions into the map sources whenever the feed updates.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !map.isStyleLoaded()) {
      return;
    }
    const collection: FeatureCollection = {
      type: "FeatureCollection",
      features: feed.vessels.map((vessel) => ({
        type: "Feature",
        properties: {
          mmsi: vessel.mmsi,
          stale: isObservationStale(vessel.observedAt, Date.now()),
          speedKnots: vessel.speedKnots,
        },
        geometry: { type: "Point", coordinates: [vessel.longitude, vessel.latitude] },
      })),
    };
    const source = map.getSource("vessels") as { setData?: (data: FeatureCollection) => void } | undefined;
    source?.setData?.(collection);
  }, [feed.vessels]);

  if (geoBaseUrl === null) {
    return (
      <section className="empty-state empty-state--alert" role="alert">
        <p className="eyebrow">{t("gate.integrationActive")}</p>
        <h2>{t("geo.notConfigured")}</h2>
        <p>{t("geo.notConfiguredDetail")}</p>
      </section>
    );
  }

  const center: [number, number] = defaultBbox
    ? [(defaultBbox.minLon + defaultBbox.maxLon) / 2, (defaultBbox.minLat + defaultBbox.maxLat) / 2]
    : [3.4, 6.4];

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Geospatial</p>
          <h2>{t("heatmap.title")}</h2>
        </div>
        <p className="section-note">
          Live vessel positions from the approved geo-service (bbox-polled every {VESSEL_POLL_INTERVAL_MS / 1000}s),
          rendered as a density heatmap. Positions older than 15 minutes are flagged stale; backend failures surface
          as errors, never as fabricated traffic.
        </p>
      </div>

      <MapPanel
        styleUrl={tileStyleUrl}
        center={center}
        zoom={defaultBbox ? 6 : 5}
        ariaLabel={t("heatmap.title")}
        onMapReady={(map) => {
          mapRef.current = map;
          map.addSource("vessels", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "vessel-heat",
            type: "heatmap",
            source: "vessels",
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "speedKnots"], 0, 0.4, 25, 1],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 9, 20],
              "heatmap-opacity": 0.7,
            },
          });
          map.addLayer({
            id: "vessel-points",
            type: "circle",
            source: "vessels",
            minzoom: 7,
            paint: {
              "circle-radius": 4,
              "circle-color": ["case", ["get", "stale"], "#b7791f", "#2c7a7b"],
              "circle-stroke-width": 1,
              "circle-stroke-color": "#0b1d2a",
            },
          });
          setMapReady((current) => current + 1);
          return () => {
            mapRef.current = null;
          };
        }}
      />

      <div className="briefing-panel" aria-live="polite">
        {feed.error !== null ? (
          <div className="empty-state empty-state--alert" role="alert">
            <p className="eyebrow">Vessel feed unavailable</p>
            <pre>{feed.error}</pre>
          </div>
        ) : (
          <p>
            {feed.vessels.length} {t("heatmap.vesselsInView")}
            {feed.staleCount > 0 ? ` — ${feed.staleCount} ${t("geo.staleData").toLowerCase()}` : ""}
            {feed.updatedAt !== null ? ` — ${t("geo.lastUpdated")}: ${new Date(feed.updatedAt).toLocaleTimeString()}` : ""}
            {feed.polling ? " (refreshing…)" : ""}
          </p>
        )}
        {feed.error === null && feed.updatedAt !== null && feed.vessels.length === 0 && (
          <p className="section-note">
            The geo-service returned zero vessels for the current viewport. This is an honest empty result — the
            ingest plane may have no coverage here, or your clearance filters all rows.
          </p>
        )}
      </div>
    </section>
  );
}
