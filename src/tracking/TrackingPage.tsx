// TrackingPage is the #/tracking console: a live vessel-tracking view over
// the blueeconomy-geo-service /v1/geo API. Fail-closed doctrine: every
// marker, polygon and alert on the map is a validated observation returned
// by the geo API for this session's clearance; when the service is
// unreachable the console shows an explicit DEGRADED state and never
// fabricates vessel data. Polling (no WebSocket) matches the platform's
// store-forward doctrine and the geo architecture integration note.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeospatialRuntimeConfiguration } from "../runtime-config";
import { GeoApiError, listSOS, listVessels, listZones, vesselTrack } from "./geo-client";
import {
  canReadSOS,
  classificationCovers,
  formatCourseDegrees,
  formatDegrees,
  formatSpeedKnots,
  isGeoReader,
  isStalePosition,
  isUnmatchedTrack,
  sourceClassBadge,
  sourceClassLabel,
  vesselDisplayName,
  vesselKey,
  type Classification,
  type GeoZone,
  type PositionSourceClass,
  type SOSAlert,
  type VesselSummary,
} from "./geo-model";
import { CesiumMap } from "./CesiumMap";
import { MapLibreMap } from "./MapLibreMap";
import { detectWebGL2, readMapPreference, resolveEngine, writeMapPreference, type MapEngine, type MapPreference } from "./map-support";
import { classificationChipClass } from "./map-style";

// TRACK_WINDOW_HOURS is the track-history window drawn when a vessel is
// selected (GET /vessels/{mmsi}/track from..to).
const TRACK_WINDOW_HOURS = 24;
const VESSEL_LIST_LIMIT = 1_000;
const VESSEL_PANEL_ROWS = 200;

interface FeedData {
  vessels: VesselSummary[];
  droppedVessels: number;
  zones: GeoZone[];
  zonesError: string | null;
  sosAlerts: SOSAlert[];
  sosError: string | null;
  fetchedAtMs: number;
}

type FeedStatus =
  | { kind: "connecting" }
  | { kind: "live"; fetchedAtMs: number }
  | { kind: "degraded"; message: string; httpStatus: number | null; sinceMs: number; lastGoodMs: number | null };

type TrackState =
  | { kind: "idle" }
  | { kind: "loading"; key: string }
  | { kind: "ready"; key: string; line: [number, number][] }
  | { kind: "empty"; key: string }
  | { kind: "failed"; key: string; message: string };

interface TrackingPageProperties {
  configuration: GeospatialRuntimeConfiguration;
  token: string;
  roles: ReadonlySet<string>;
  clearance: Classification | null;
  onUnauthorized: () => void;
}

export function TrackingPage({ configuration, token, roles, clearance, onUnauthorized }: TrackingPageProperties) {
  const [data, setData] = useState<FeedData | null>(null);
  const [status, setStatus] = useState<FeedStatus>({ kind: "connecting" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackState>({ kind: "idle" });
  const [sourceFilter, setSourceFilter] = useState<"all" | PositionSourceClass | "unmatched">("all");
  const [showZones, setShowZones] = useState(true);
  const [preference, setPreference] = useState<MapPreference>(() => readMapPreference());
  const [engineError, setEngineError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const sosAuthorized = canReadSOS(roles, clearance);
  const webgl2 = useMemo(() => detectWebGL2(), []);
  const engine: MapEngine = engineError === null ? resolveEngine(preference, webgl2) : "maplibre2d";

  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      const vesselResult = await listVessels(configuration, token, null, VESSEL_LIST_LIMIT);
      // Zones and SOS degrade per-section: a tenant-binding or clearance
      // failure on a secondary layer must not take down the live picture.
      const zoneResult = await listZones(configuration, token).then(
        (result) => ({ zones: result.zones, error: null as string | null }),
        (error: unknown) => ({ zones: [] as GeoZone[], error: describeSectionError(error) }),
      );
      const sosResult = sosAuthorized
        ? await listSOS(configuration, token).then(
            (result) => ({ alerts: result.alerts, error: null as string | null }),
            (error: unknown) => ({ alerts: [] as SOSAlert[], error: describeSectionError(error) }),
          )
        : { alerts: [] as SOSAlert[], error: null as string | null };
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      setData({
        vessels: vesselResult.vessels,
        droppedVessels: vesselResult.dropped,
        zones: zoneResult.zones,
        zonesError: zoneResult.error,
        sosAlerts: sosResult.alerts,
        sosError: sosResult.error,
        fetchedAtMs,
      });
      setStatus({ kind: "live", fetchedAtMs });
    } catch (error) {
      if (error instanceof GeoApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      const previous = statusRef.current;
      const lastGoodMs = previous.kind === "live" ? previous.fetchedAtMs : previous.kind === "degraded" ? previous.lastGoodMs : null;
      setStatus({
        kind: "degraded",
        message: error instanceof Error ? error.message : "geo-service query failed",
        httpStatus: error instanceof GeoApiError ? error.status : null,
        sinceMs: Date.now(),
        lastGoodMs,
      });
    }
  }, [configuration, token, sosAuthorized, onUnauthorized]);

  // Poll on the deployment-configured interval; polling (not WebSocket) is
  // the geo architecture's integration doctrine for the portal.
  useEffect(() => {
    let active = true;
    const guarded = () => {
      if (active) {
        void refresh();
      }
    };
    guarded();
    const interval = window.setInterval(guarded, configuration.poll_interval_ms);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refresh, configuration.poll_interval_ms]);

  // Load the 24-hour track whenever an MMSI-bound vessel is selected.
  const selectedVessel = useMemo(
    () => data?.vessels.find((vessel) => vesselKey(vessel) === selectedKey) ?? null,
    [data, selectedKey],
  );
  useEffect(() => {
    if (selectedVessel === null || selectedVessel.mmsi === "") {
      setTrack({ kind: "idle" });
      return;
    }
    const key = vesselKey(selectedVessel);
    const mmsi = selectedVessel.mmsi;
    let active = true;
    setTrack({ kind: "loading", key });
    const to = new Date();
    const from = new Date(to.getTime() - TRACK_WINDOW_HOURS * 3_600_000);
    void vesselTrack(configuration, token, mmsi, from.toISOString(), to.toISOString()).then(
      (line) => {
        if (!active) {
          return;
        }
        setTrack(line.length >= 2 ? { kind: "ready", key, line } : { kind: "empty", key });
      },
      (error: unknown) => {
        if (active) {
          setTrack({ kind: "failed", key, message: error instanceof Error ? error.message : "track query failed" });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [selectedVessel, configuration, token]);

  function changePreference(next: MapPreference): void {
    setPreference(next);
    writeMapPreference(next);
    setEngineError(null);
  }

  const filteredVessels = useMemo(() => {
    const vessels = data?.vessels ?? [];
    if (sourceFilter === "all") {
      return vessels;
    }
    if (sourceFilter === "unmatched") {
      return vessels.filter(isUnmatchedTrack);
    }
    return vessels.filter((vessel) => vessel.sourceClass === sourceFilter && !isUnmatchedTrack(vessel));
  }, [data, sourceFilter]);

  const trackLine = track.kind === "ready" && selectedVessel !== null && track.key === vesselKey(selectedVessel) ? track.line : null;

  const mapProperties = {
    tileUrl: configuration.tile_url,
    ...(configuration.tile_attribution === undefined ? {} : { tileAttribution: configuration.tile_attribution }),
    vessels: filteredVessels,
    zones: showZones ? (data?.zones ?? []) : [],
    sosAlerts: sosAuthorized ? (data?.sosAlerts ?? []) : [],
    trackLine,
    selectedKey,
    nowMs,
    onSelectVessel: setSelectedKey,
    onEngineError: (message: string) => setEngineError(message),
  };

  return (
    <section className="tracking-console">
      <ClassificationBanner clearance={clearance} sosVisible={sosAuthorized} />

      <div className="tracking-toolbar">
        <FeedStatusChip status={status} onRetry={() => void refresh()} />
        <div className="tracking-toolbar__group" role="group" aria-label="Map engine">
          <span className="tracking-toolbar__label">Map engine</span>
          {(["auto", "cesium3d", "maplibre2d"] as const).map((option) => (
            <button
              key={option}
              className={preference === option ? "chip-toggle chip-toggle--active" : "chip-toggle"}
              onClick={() => changePreference(option)}
            >
              {option === "auto" ? "Auto" : option === "cesium3d" ? "3D (Cesium)" : "2D (MapLibre)"}
            </button>
          ))}
        </div>
        <div className="tracking-toolbar__group" role="group" aria-label="Layers">
          <span className="tracking-toolbar__label">Layers</span>
          <button className={showZones ? "chip-toggle chip-toggle--active" : "chip-toggle"} onClick={() => setShowZones((current) => !current)}>
            Geofence zones
          </button>
        </div>
        <div className="tracking-toolbar__group" role="group" aria-label="Source filter">
          <label className="tracking-toolbar__label" htmlFor="source-filter">Source</label>
          <select id="source-filter" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
            <option value="all">All sources</option>
            <option value="AIS">AIS</option>
            <option value="GSM_TRACKER">GSM tracker</option>
            <option value="SAT_TRACKER">Satellite tracker</option>
            <option value="APP_REPORT">App report</option>
            <option value="unmatched">Unmatched / dark</option>
          </select>
        </div>
      </div>

      {status.kind === "degraded" && <DegradedNotice status={status} hasLastGood={data !== null} onRetry={() => void refresh()} />}
      {engineError !== null && (
        <section className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Map engine unavailable</p>
          <h2>The selected map engine could not start</h2>
          <p>{engineError}. The console fell back to the 2D engine; choose “2D (MapLibre)” above to make the selection explicit.</p>
        </section>
      )}

      <div className="tracking-layout">
        <div className="tracking-map">
          {engine === "cesium3d" ? <CesiumMap {...mapProperties} /> : <MapLibreMap {...mapProperties} />}
          <p className="tracking-map__legend">
            <span><i className="legend-dot" style={{ background: "#58c4dd" }} /> AIS</span>
            <span><i className="legend-dot" style={{ background: "#9be2b8" }} /> GSM</span>
            <span><i className="legend-dot" style={{ background: "#b39ddb" }} /> SAT</span>
            <span><i className="legend-dot" style={{ background: "#e9c46a" }} /> APP</span>
            <span><i className="legend-dot legend-dot--hollow" /> unmatched / dark</span>
            {sosAuthorized && <span><i className="legend-dot" style={{ background: "#ff5252" }} /> SOS</span>}
          </p>
        </div>
        <aside className="tracking-side">
          <VesselDetailPanel
            vessel={selectedVessel}
            track={selectedVessel !== null && track.kind !== "idle" && track.key === vesselKey(selectedVessel) ? track : { kind: "idle" }}
            nowMs={nowMs}
            onClose={() => setSelectedKey(null)}
          />
          <VesselListPanel
            vessels={filteredVessels}
            total={data?.vessels.length ?? 0}
            dropped={data?.droppedVessels ?? 0}
            loading={status.kind === "connecting"}
            selectedKey={selectedKey}
            nowMs={nowMs}
            onSelect={setSelectedKey}
          />
          {sosAuthorized && <SOSPanel alerts={data?.sosAlerts ?? []} error={data?.sosError ?? null} />}
          {data?.zonesError != null && showZones && (
            <p className="tracking-note" role="status">Geofence zone layer unavailable: {data.zonesError}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function describeSectionError(error: unknown): string {
  if (error instanceof GeoApiError) {
    return error.status === null ? error.message : `HTTP ${error.status} — ${error.message}`;
  }
  return error instanceof Error ? error.message : "query failed";
}

// ClassificationBanner is the platform-convention handling banner for the
// console: it states the session's clearance on the geo ladder and the
// handling consequence, and shifts to the alert treatment at RESTRICTED+.
function ClassificationBanner({ clearance, sosVisible }: { clearance: Classification | null; sosVisible: boolean }) {
  const label = clearance ?? "PUBLIC";
  const elevated = clearance !== null && classificationCovers(clearance, "RESTRICTED");
  return (
    <section className={elevated ? "assurance-banner assurance-banner--restricted" : "assurance-banner"}>
      <span className="assurance-mark">Classification {label}</span>
      <p>
        Session clearance on the geo ladder is <strong>{label}</strong>; every layer shown is limited to records the geo-service
        released for this clearance. {sosVisible
          ? "The SOS layer is visible because this session holds the geo-sos-reader role at RESTRICTED or higher — handle accordingly."
          : "SOS alerting (RESTRICTED minimum) is not visible to this session."} No cached, simulated or substitute vessel data is ever rendered.
      </p>
    </section>
  );
}

function FeedStatusChip({ status, onRetry }: { status: FeedStatus; onRetry: () => void }) {
  if (status.kind === "connecting") {
    return <span className="probe-status probe-status--neutral">Connecting to geo-service…</span>;
  }
  if (status.kind === "live") {
    return <span className="probe-status probe-status--success">Live — confirmed observations at {new Date(status.fetchedAtMs).toLocaleTimeString()}</span>;
  }
  return (
    <span className="probe-status probe-status--failure">
      DEGRADED since {new Date(status.sinceMs).toLocaleTimeString()}{" "}
      <button className="button button--quiet" onClick={onRetry}>Retry now</button>
    </span>
  );
}

function DegradedNotice({ status, hasLastGood, onRetry }: { status: Extract<FeedStatus, { kind: "degraded" }>; hasLastGood: boolean; onRetry: () => void }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Feed degraded</p>
      <h2>Geo-service observations are not current</h2>
      <p>
        {status.message}.{" "}
        {hasLastGood && status.lastGoodMs !== null
          ? `Markers below are the last confirmed observations from ${new Date(status.lastGoodMs).toLocaleString()} and are rendered stale-dimmed; nothing has been fabricated.`
          : "No confirmed observations are available, so the map shows the base layer only."}
      </p>
      <button className="button button--outline" onClick={onRetry}>Retry the authorised call</button>
    </section>
  );
}

interface VesselListPanelProperties {
  vessels: VesselSummary[];
  total: number;
  dropped: number;
  loading: boolean;
  selectedKey: string | null;
  nowMs: number;
  onSelect: (key: string | null) => void;
}

function VesselListPanel({ vessels, total, dropped, loading, selectedKey, nowMs, onSelect }: VesselListPanelProperties) {
  const shown = vessels.slice(0, VESSEL_PANEL_ROWS);
  return (
    <section className="tracking-panel">
      <h3 className="tracking-panel__title">Confirmed vessels ({total})</h3>
      {loading && <p className="tracking-note">Waiting for the first authorised response…</p>}
      {!loading && vessels.length === 0 && <p className="tracking-note">No vessels match the current source filter in the confirmed feed.</p>}
      {dropped > 0 && <p className="tracking-note tracking-note--warn">{dropped} record{dropped === 1 ? "" : "s"} failed contract validation and {dropped === 1 ? "was" : "were"} not plotted.</p>}
      <ul className="vessel-list">
        {shown.map((vessel) => {
          const key = vesselKey(vessel);
          const stale = isStalePosition(vessel, nowMs);
          return (
            <li key={key}>
              <button
                className={selectedKey === key ? "vessel-row vessel-row--selected" : "vessel-row"}
                onClick={() => onSelect(selectedKey === key ? null : key)}
              >
                <span className={stale ? "vessel-row__name vessel-row__name--stale" : "vessel-row__name"}>{vesselDisplayName(vessel)}</span>
                <span className={`source-badge source-badge--${vessel.sourceClass.toLowerCase()}`}>{sourceClassBadge(vessel.sourceClass)}</span>
                {isUnmatchedTrack(vessel) && <span className="source-badge source-badge--unmatched">dark</span>}
                {stale && <span className="vessel-row__stale">stale</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {vessels.length > shown.length && <p className="tracking-note">Showing the first {shown.length} of {vessels.length} matches; narrow the source filter.</p>}
    </section>
  );
}

interface VesselDetailPanelProperties {
  vessel: VesselSummary | null;
  track: TrackState;
  nowMs: number;
  onClose: () => void;
}

function VesselDetailPanel({ vessel, track, nowMs, onClose }: VesselDetailPanelProperties) {
  if (vessel === null) {
    return (
      <section className="tracking-panel">
        <h3 className="tracking-panel__title">Vessel detail</h3>
        <p className="tracking-note">Select a marker or a list row to inspect a confirmed vessel.</p>
      </section>
    );
  }
  const stale = isStalePosition(vessel, nowMs);
  const lat = vessel.latitudeMicros / 1_000_000;
  const lon = vessel.longitudeMicros / 1_000_000;
  return (
    <section className="tracking-panel tracking-panel--detail">
      <div className="tracking-panel__heading">
        <h3 className="tracking-panel__title">{vesselDisplayName(vessel)}</h3>
        <button className="button button--quiet" onClick={onClose}>Close</button>
      </div>
      <dl className="vessel-detail">
        <div><dt>MMSI</dt><dd>{vessel.mmsi !== "" ? vessel.mmsi : "not bound (unmatched report)"}</dd></div>
        {vessel.vesselRef !== undefined && <div><dt>Vessel reference</dt><dd>{vessel.vesselRef}</dd></div>}
        <div>
          <dt>Source class</dt>
          <dd><span className={`source-badge source-badge--${vessel.sourceClass.toLowerCase()}`}>{sourceClassBadge(vessel.sourceClass)}</span> {sourceClassLabel(vessel.sourceClass)}</dd>
        </div>
        <div><dt>Classification</dt><dd><span className={classificationChipClass(vessel.classification)}>{vessel.classification}</span></dd></div>
        <div><dt>SOG</dt><dd>{formatSpeedKnots(vessel.speedOverGroundMilliknots)}</dd></div>
        <div><dt>COG</dt><dd>{formatCourseDegrees(vessel.courseOverGroundMillidegrees)}</dd></div>
        <div><dt>Position</dt><dd>{formatDegrees(lat, "N", "S")} · {formatDegrees(lon, "E", "W")}</dd></div>
        {vessel.shipTypeCode !== undefined && <div><dt>AIS ship type code</dt><dd>{vessel.shipTypeCode}</dd></div>}
        <div><dt>Observed</dt><dd>{new Date(vessel.observedAt).toLocaleString()}{stale ? " — stale (over 30 minutes old)" : ""}</dd></div>
      </dl>
      {vessel.mmsi !== "" && (
        <p className="tracking-note">
          {track.kind === "loading" && `Loading the confirmed ${TRACK_WINDOW_HOURS}-hour track…`}
          {track.kind === "ready" && `${TRACK_WINDOW_HOURS}-hour track drawn on the map (${track.line.length} points).`}
          {track.kind === "empty" && `No confirmed track points in the last ${TRACK_WINDOW_HOURS} hours at this clearance.`}
          {track.kind === "failed" && `Track unavailable: ${track.message}.`}
          {track.kind === "idle" && "Track not requested."}
        </p>
      )}
    </section>
  );
}

function SOSPanel({ alerts, error }: { alerts: SOSAlert[]; error: string | null }) {
  const active = alerts.filter((alert) => alert.state !== "RESOLVED");
  return (
    <section className="tracking-panel tracking-panel--sos">
      <h3 className="tracking-panel__title">SOS alerts ({active.length} active)</h3>
      <p className="tracking-note">RESTRICTED minimum — visible to this session under the geo-sos-reader role and clearance ladder.</p>
      {error !== null && <p className="tracking-note tracking-note--warn">SOS feed unavailable: {error}</p>}
      <ul className="sos-list">
        {alerts.map((alert) => (
          <li key={alert.sosAlertId} className="sos-item">
            <span className={`status-chip ${alert.state === "RESOLVED" ? "status-chip--active" : "status-chip--rejected"}`}>{alert.state}</span>
            <span className="sos-item__position">{formatDegrees(alert.latitudeMicros / 1_000_000, "N", "S")} · {formatDegrees(alert.longitudeMicros / 1_000_000, "E", "W")}</span>
            <span className="sos-item__time">{new Date(alert.recordedAt).toLocaleString()}</span>
            {alert.vesselReference !== undefined && <span className="sos-item__ref">ref {alert.vesselReference}</span>}
            {alert.freeText !== undefined && <span className="sos-item__text">{alert.freeText}</span>}
          </li>
        ))}
      </ul>
      {alerts.length === 0 && error === null && <p className="tracking-note">No SOS alerts released to this clearance.</p>}
    </section>
  );
}

// TrackingAccessGate renders the PBAC-aware guard for the route: the
// geo-reader role set decides whether the console renders at all; the
// backend remains the authoritative enforcer.
export function TrackingAccessNotice({ roles }: { roles: ReadonlySet<string> }) {
  if (isGeoReader(roles)) {
    return null;
  }
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Insufficient role</p>
      <h2>Your account does not hold a geo-reader role</h2>
      <p>The tracking console requires one of <code>geo-reader</code>, <code>geo-zone-maker</code>, <code>geo-zone-checker</code> or <code>geo-admin</code>. The geo-service enforces this independently; this portal simply declines to render a console your session cannot query.</p>
    </section>
  );
}
