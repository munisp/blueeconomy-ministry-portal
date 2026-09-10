import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { MapPanel } from "../components/MapPanel";
import { useTranslation } from "../i18n";
import {
  GeoApiError,
  acknowledgeSos,
  fetchSosAlerts,
  isLiveSos,
  resolveSos,
  type SosAlert,
} from "../geo-client";
import type { DashboardPageProps } from "./props";

const SOS_POLL_INTERVAL_MS = 30_000;

interface SarFeedState {
  alerts: SosAlert[];
  updatedAt: string | null;
  error: string | null;
  clearanceDenied: boolean;
}

interface ActionState {
  alertId: string;
  action: "acknowledge" | "resolve";
  pending: boolean;
  error: string | null;
}

/**
 * Incident / SAR mode (#18): live SOS ledger from the geo-service SOS
 * lifecycle endpoints with map markers and acknowledge/resolve transitions.
 * Source of truth is the signed SOS ledger; the waterway-safety service
 * exposes only a telemetry validator (no incident read API), so an
 * unconfigured geo-service fails closed. 403 responses surface the
 * clearance requirement explicitly.
 */
export function IncidentSarPage({ geoBaseUrl, token, tileStyleUrl, defaultBbox }: DashboardPageProps) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<SarFeedState>({ alerts: [], updatedAt: null, error: null, clearanceDenied: false });
  const [action, setAction] = useState<ActionState | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  const poll = useCallback(async () => {
    if (geoBaseUrl === null || token === null) {
      return;
    }
    try {
      const result = await fetchSosAlerts(geoBaseUrl, token);
      setFeed({ alerts: result.sosAlerts, updatedAt: new Date().toISOString(), error: null, clearanceDenied: false });
    } catch (error) {
      if (error instanceof GeoApiError && error.status === 403) {
        setFeed((current) => ({ ...current, clearanceDenied: true, error: null }));
        return;
      }
      setFeed((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "SOS feed request failed",
      }));
    }
  }, [geoBaseUrl, token]);

  useEffect(() => {
    void poll();
    const interval = setInterval(() => void poll(), SOS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !map.isStyleLoaded()) {
      return;
    }
    const collection: FeatureCollection = {
      type: "FeatureCollection",
      features: feed.alerts.map((alert) => ({
        type: "Feature",
        properties: { id: alert.sosAlertId, state: alert.state },
        geometry: { type: "Point", coordinates: [alert.longitude, alert.latitude] },
      })),
    };
    const source = map.getSource("sos") as { setData?: (data: FeatureCollection) => void } | undefined;
    source?.setData?.(collection);
  }, [feed.alerts]);

  async function runLifecycle(alert: SosAlert, kind: "acknowledge" | "resolve"): Promise<void> {
    if (geoBaseUrl === null || token === null) {
      return;
    }
    setAction({ alertId: alert.sosAlertId, action: kind, pending: true, error: null });
    try {
      const updated = kind === "acknowledge" ? await acknowledgeSos(geoBaseUrl, token, alert.sosAlertId) : await resolveSos(geoBaseUrl, token, alert.sosAlertId);
      setFeed((current) => ({
        ...current,
        alerts: current.alerts.map((candidate) => (candidate.sosAlertId === updated.sosAlertId ? updated : candidate)),
      }));
      setAction(null);
    } catch (error) {
      const message =
        error instanceof GeoApiError && error.status === 409
          ? "Illegal lifecycle transition: the alert is no longer in a state that permits this action. The ledger was not modified locally."
          : error instanceof GeoApiError && error.status === 403
            ? "The geo-service refused the transition (HTTP 403): a geo-sos-reader/geo-admin role and RESTRICTED clearance are required."
            : error instanceof Error
              ? error.message
              : "lifecycle transition failed";
      setAction({ alertId: alert.sosAlertId, action: kind, pending: false, error: message });
    }
  }

  if (geoBaseUrl === null) {
    return (
      <section className="empty-state empty-state--alert" role="alert">
        <p className="eyebrow">{t("gate.integrationActive")}</p>
        <h2>{t("geo.notConfigured")}</h2>
        <p>{t("geo.notConfiguredDetail")}</p>
      </section>
    );
  }

  const liveAlerts = feed.alerts.filter(isLiveSos);
  const historyAlerts = feed.alerts.filter((alert) => !isLiveSos(alert));
  const center: [number, number] = defaultBbox
    ? [(defaultBbox.minLon + defaultBbox.maxLon) / 2, (defaultBbox.minLat + defaultBbox.maxLat) / 2]
    : [3.4, 6.4];

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Safety of navigation</p>
          <h2>{t("sar.title")}</h2>
        </div>
        <p className="section-note">
          Live SOS/incident ledger from the geo-service signed lifecycle surface (polled every{" "}
          {SOS_POLL_INTERVAL_MS / 1000}s). Only RAISED and ACKNOWLEDGED alerts are live; lifecycle transitions are
          executed against the backend and re-read, never assumed.
        </p>
      </div>

      {feed.clearanceDenied ? (
        <div className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Clearance gate active</p>
          <p>{t("sar.clearanceDenied")}</p>
        </div>
      ) : feed.error !== null ? (
        <div className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">SOS feed unavailable</p>
          <pre>{feed.error}</pre>
        </div>
      ) : (
        <>
          <MapPanel
            styleUrl={tileStyleUrl}
            center={center}
            zoom={defaultBbox ? 6 : 5}
            ariaLabel={t("sar.title")}
            onMapReady={(map) => {
              mapRef.current = map;
              map.addSource("sos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
              map.addLayer({
                id: "sos-points",
                type: "circle",
                source: "sos",
                paint: {
                  "circle-radius": 7,
                  "circle-color": [
                    "match",
                    ["get", "state"],
                    "RAISED", "#c53030",
                    "ACKNOWLEDGED", "#b7791f",
                    "#4a5568",
                  ],
                  "circle-stroke-width": 2,
                  "circle-stroke-color": "#ffffff",
                },
              });
              return () => {
                mapRef.current = null;
              };
            }}
          />

          <div className="briefing-panel" aria-live="polite">
            <h3>{t("sar.liveAlerts")} ({liveAlerts.length})</h3>
            {liveAlerts.length === 0 && (
              <p className="section-note">
                {t("sar.noLiveAlerts")} — the geo-service returned an empty ledger
                {feed.updatedAt !== null ? ` (${t("geo.lastUpdated")}: ${new Date(feed.updatedAt).toLocaleTimeString()})` : ""}.
                This is an honest empty result, not a placeholder.
              </p>
            )}
            <ul className="incident-list">
              {liveAlerts.map((alert) => (
                <li key={alert.sosAlertId} className={`incident-item incident-item--${alert.state.toLowerCase()}`}>
                  <p>
                    <strong>{alert.state}</strong> — vessel {alert.vesselReference} at {alert.latitude.toFixed(4)}°,{" "}
                    {alert.longitude.toFixed(4)}° · recorded {alert.recordedAt}
                  </p>
                  {alert.freeText !== null && <p>{alert.freeText}</p>}
                  {alert.acknowledgedBy !== null && <p className="section-note">Acknowledged by {alert.acknowledgedBy} at {alert.acknowledgedAt}</p>}
                  <div className="period-selector">
                    {alert.state === "RAISED" && (
                      <button
                        className="button button--outline"
                        disabled={action?.pending === true}
                        onClick={() => void runLifecycle(alert, "acknowledge")}
                      >
                        {t("sar.acknowledge")}
                      </button>
                    )}
                    <button
                      className="button button--outline"
                      disabled={action?.pending === true}
                      onClick={() => void runLifecycle(alert, "resolve")}
                    >
                      {t("sar.resolve")}
                    </button>
                  </div>
                  {action !== null && action.alertId === alert.sosAlertId && action.error !== null && (
                    <div className="empty-state empty-state--alert" role="alert">
                      <pre>{action.error}</pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {historyAlerts.length > 0 && (
              <details>
                <summary>Resolved history ({historyAlerts.length})</summary>
                <ul className="incident-list">
                  {historyAlerts.map((alert) => (
                    <li key={alert.sosAlertId} className="incident-item incident-item--resolved">
                      <p>
                        RESOLVED — vessel {alert.vesselReference} · resolved by {alert.resolvedBy ?? "unknown"} at{" "}
                        {alert.resolvedAt ?? "unknown"}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}
