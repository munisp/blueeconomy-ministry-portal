// geo-client is the typed /v1/geo REST boundary for the tracking console
// (blueeconomy-geo-service openapi.yaml). It follows the portal's existing
// client conventions: bearer token, no-store, abort timeouts, truthful
// error kinds (http/network/contract) and fail-closed response-shape
// validation via geo-model parsers. A response that fails validation drops
// the offending records; a wholly invalid envelope is a contract error.
import type { GeospatialRuntimeConfiguration } from "../runtime-config";
import {
  bboxToQuery,
  isValidMmsi,
  parseSOSAlert,
  parseTrackLineString,
  parseVesselSummary,
  parseZone,
  type BboxMicros,
  type GeoZone,
  type SOSAlert,
  type VesselSummary,
} from "./geo-model";

export type GeoErrorKind = "http" | "network" | "contract";

// GeoApiError carries the observed failure truthfully, mirroring
// AdministrationApiError: the HTTP status for server responses, null for
// network failures, and a contract kind for malformed payloads.
export class GeoApiError extends Error {
  readonly kind: GeoErrorKind;
  readonly status: number | null;

  constructor(kind: GeoErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "GeoApiError";
    this.kind = kind;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

export interface VesselListResult {
  vessels: VesselSummary[];
  // dropped counts records that failed fail-closed validation; the console
  // surfaces this so silent data loss is impossible to confuse with "no
  // vessels".
  dropped: number;
}

export interface SOSListResult {
  alerts: SOSAlert[];
  dropped: number;
}

export interface ZoneListResult {
  zones: GeoZone[];
  dropped: number;
}

function baseUrl(configuration: GeospatialRuntimeConfiguration): string {
  return configuration.geo_api_url.replace(/\/+$/, "");
}

async function geoFetch(configuration: GeospatialRuntimeConfiguration, token: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl(configuration)}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json, application/geo+json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "request timed out" : error instanceof Error ? error.message : "network failure";
    throw new GeoApiError("network", null, `geo-service could not be reached (${reason})`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new GeoApiError("http", response.status, `geo-service returned HTTP ${response.status}`);
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GeoApiError("contract", response.status, "geo-service returned a non-JSON response");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// listVessels reads GET /v1/geo/vessels; a null bbox uses the API's
// whole-world default.
export async function listVessels(
  configuration: GeospatialRuntimeConfiguration,
  token: string,
  bbox: BboxMicros | null,
  limit = 1_000,
): Promise<VesselListResult> {
  const parameters = new URLSearchParams();
  if (bbox !== null) {
    parameters.set("bbox", bboxToQuery(bbox));
  }
  parameters.set("limit", String(limit));
  const response = await geoFetch(configuration, token, `/vessels?${parameters.toString()}`);
  const candidate: unknown = await readJson(response);
  if (!isRecord(candidate) || !Array.isArray(candidate.vessels)) {
    throw new GeoApiError("contract", response.status, "geo-service vessel list returned an unexpected response shape");
  }
  const vessels: VesselSummary[] = [];
  let dropped = 0;
  for (const item of candidate.vessels) {
    const parsed = parseVesselSummary(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      vessels.push(parsed);
    }
  }
  return { vessels, dropped };
}

// vesselTrack reads GET /v1/geo/vessels/{mmsi}/track (GeoJSON LineString,
// degree coordinates per RFC 7946). An empty-but-valid window resolves to
// an empty coordinate list; a malformed payload is a contract error.
export async function vesselTrack(
  configuration: GeospatialRuntimeConfiguration,
  token: string,
  mmsi: string,
  fromIso: string,
  toIso: string,
): Promise<[number, number][]> {
  if (!isValidMmsi(mmsi)) {
    throw new GeoApiError("contract", null, "track requests require a 9-digit MMSI");
  }
  const parameters = new URLSearchParams({ from: fromIso, to: toIso });
  const response = await geoFetch(configuration, token, `/vessels/${encodeURIComponent(mmsi)}/track?${parameters.toString()}`);
  const candidate: unknown = await readJson(response);
  const line = parseTrackLineString(candidate);
  if (line === null) {
    throw new GeoApiError("contract", response.status, "geo-service track returned an unexpected GeoJSON shape");
  }
  return line;
}

// listZones reads GET /v1/geo/zones (tenant-scoped, clearance-filtered).
export async function listZones(configuration: GeospatialRuntimeConfiguration, token: string): Promise<ZoneListResult> {
  const response = await geoFetch(configuration, token, "/zones");
  const candidate: unknown = await readJson(response);
  if (!isRecord(candidate) || !Array.isArray(candidate.zones)) {
    throw new GeoApiError("contract", response.status, "geo-service zone list returned an unexpected response shape");
  }
  const zones: GeoZone[] = [];
  let dropped = 0;
  for (const item of candidate.zones) {
    const parsed = parseZone(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      zones.push(parsed);
    }
  }
  return { zones, dropped };
}

// listSOS reads GET /v1/geo/sos. Callers must gate on canReadSOS first; the
// backend re-enforces role + RESTRICTED clearance authoritatively.
export async function listSOS(configuration: GeospatialRuntimeConfiguration, token: string, limit = 200): Promise<SOSListResult> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  const response = await geoFetch(configuration, token, `/sos?${parameters.toString()}`);
  const candidate: unknown = await readJson(response);
  if (!isRecord(candidate) || !Array.isArray(candidate.sosAlerts)) {
    throw new GeoApiError("contract", response.status, "geo-service SOS list returned an unexpected response shape");
  }
  const alerts: SOSAlert[] = [];
  let dropped = 0;
  for (const item of candidate.sosAlerts) {
    const parsed = parseSOSAlert(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      alerts.push(parsed);
    }
  }
  return { alerts, dropped };
}

// probeGeoHealth hits the unauthenticated /healthz sibling of /v1/geo so
// the console can distinguish "service down" from "query failed".
export async function probeGeoHealth(configuration: GeospatialRuntimeConfiguration): Promise<boolean> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const root = baseUrl(configuration).replace(/\/v1\/geo$/, "");
    const response = await fetch(`${root}/healthz`, { method: "GET", cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
