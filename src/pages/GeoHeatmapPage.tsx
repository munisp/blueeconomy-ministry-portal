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

/** Debounce for viewport-driven refetches: moveend fires per gesture step. */
const MOVEEND_DEBOUNCE_MS = 350;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Cheap change signature for the vessel feed. Positions update a handful of
 * times per minute; identical payloads skip both the React state update and
 * the MapLibre source setData (feature diffing).
 */
function vesselSignature(vessels: GeoVessel[]): string {
  return vessels
    .map((vessel) => `${vessel.mmsi}:${vessel.longitude.toFixed(5)},${vessel.latitude.toFixed(5)},${vessel.speedKnots},${vessel.observedAt}`)
    .join("|");
}

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

  // In-flight request handle + last applied signature live in refs so the
  // poll closure stays stable and superseded requests can be cancelled.
  const abortRef = useRef<AbortController | null>(null);
  const signatureRef = useRef<string>("");

  const poll = useCallback(async () => {
    if (geoBaseUrl === null || token === null || mapRef.current === null) {
      return;
    }
    // Request cancellation: a newer poll supersedes any in-flight request
    // (e.g. interval firing while a moveend refetch is still running).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFeed((current) => ({ ...current, polling: true }));
    try {
      const bbox = mapBoundsToBbox(mapRef.current);
      const result = await fetchVesselsInBbox(geoBaseUrl, token, bbox, 1000, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      const signature = vesselSignature(result.vessels);
      // Feature diffing: skip the state update (and downstream MapLibre
      // setData) when the payload is unchanged since the last applied poll.
      if (signature === signatureRef.current) {
        setFeed((current) => ({ ...current, polling: false, error: null }));
        return;
      }
      signatureRef.current = signature;
      const nowMs = Date.now();
      setFeed({
        vessels: result.vessels,
        staleCount: result.vessels.filter((vessel) => isObservationStale(vessel.observedAt, nowMs)).length,
        updatedAt: new Date(nowMs).toISOString(),
        error: null,
        polling: false,
      });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        return;
      }
      const message =
        error instanceof GeoApiError && error.status === 403
          ? "The geo-service refused the request (HTTP 403): your session lacks a geo-reader role or sufficient clearance."
          : error instanceof Error
            ? error.message
            : "vessel feed request failed";
      setFeed((current) => ({ ...current, error: message, polling: false }));
    }
  }, [geoBaseUrl, token]);

  // Poll on an interval once the map exists — but only while the tab is
  // visible (hidden tabs stop burning geo-service quota); re-poll, debounced
  // and coalesced, after viewport moves settle.
  useEffect(() => {
    if (geoBaseUrl === null || token === null || mapRef.current === null) {
      return;
    }
    void poll();
    const interval = setInterval(() => {
      if (!document.hidden) {
        void poll();
      }
    }, VESSEL_POLL_INTERVAL_MS);
    const map = mapRef.current;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      if (moveTimer !== null) {
        clearTimeout(moveTimer);
      }
      moveTimer = setTimeout(() => {
        moveTimer = null;
        if (!document.hidden) {
          void poll();
        }
      }, MOVEEND_DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (!document.hidden) {
        void poll();
      }
    };
    map.on("moveend", onMoveEnd);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      map.off("moveend", onMoveEnd);
      document.removeEventListener("visibilitychange", onVisibility);
      if (moveTimer !== null) {
        clearTimeout(moveTimer);
      }
      abortRef.current?.abort();
      abortRef.current = null;
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
