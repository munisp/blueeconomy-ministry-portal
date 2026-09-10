import type { PortalRuntimeConfiguration } from "./runtime-config";

/**
 * Geospatial data layer for the blueeconomy-geo-service REST API.
 *
 * Doctrine: fail-closed, real data only. Coordinates on the wire are
 * fixed-point micro-degrees (integers); this module converts them to
 * degrees exactly once, at the boundary, and never fabricates positions,
 * forecasts or alerts. Transport failures, malformed payloads, clearance
 * denials (403) and honest backend refusals (409 INSUFFICIENT_HISTORY)
 * all surface as typed errors/result states.
 */

export const GEO_SERVICE_ID = "geo-service";

export const GEO_ENDPOINTS = {
  vessels: "/v1/geo/vessels",
  fences: "/v1/geo/fences",
  sos: "/v1/geo/sos",
  congestionForecast: (portCode: string) => `/v1/geo/ports/${portCode}/congestion/forecast`,
  sosAcknowledge: (id: string) => `/v1/geo/sos/${encodeURIComponent(id)}/acknowledge`,
  sosResolve: (id: string) => `/v1/geo/sos/${encodeURIComponent(id)}/resolve`,
} as const;

/** Vessels whose newest position is older than this are flagged stale (matches the backend provenance threshold). */
export const VESSEL_STALE_AFTER_MS = 15 * 60 * 1000;

/** Default viewport polling cadence for the live vessel layer. */
export const VESSEL_POLL_INTERVAL_MS = 30_000;

export type GeoErrorKind = "http" | "network" | "invalid-payload" | "not-configured";

export class GeoApiError extends Error {
  readonly kind: GeoErrorKind;
  readonly status?: number;
  /** Parsed JSON error body when the backend returned one (e.g. the 409 INSUFFICIENT_HISTORY payload). */
  readonly payload?: Record<string, unknown>;

  constructor(kind: GeoErrorKind, message: string, status?: number, payload?: Record<string, unknown>) {
    super(message);
    this.name = "GeoApiError";
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Resolve the geo-service origin from the approved service registry.
 * Fail-closed: returns null when no service carries the `geo-service` id —
 * callers must render an explicit "not configured" state and never fall
 * back to another service origin for geospatial data.
 */
export function resolveGeoApiBase(configuration: PortalRuntimeConfiguration): string | null {
  const service = configuration.services.find((candidate) => candidate.id === GEO_SERVICE_ID);
  if (service === undefined) {
    return null;
  }
  return new URL(service.health_url).origin;
}

/* ------------------------------------------------------------------------ */
/* Coordinate and bounding-box helpers                                       */
/* ------------------------------------------------------------------------ */

export function microsToDegrees(micros: number): number {
  return micros / 1_000_000;
}

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Serialise a degree bbox into the backend's fixed-point micro-degree query format. */
export function bboxToQuery(bbox: Bbox): string {
  const toMicros = (degrees: number) => Math.round(degrees * 1_000_000);
  return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].map(toMicros).join(",");
}

/** A position is stale when its observation is older than the provenance threshold. */
export function isObservationStale(observedAt: string, nowMs: number, staleAfterMs = VESSEL_STALE_AFTER_MS): boolean {
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) {
    return true;
  }
  return nowMs - observedMs > staleAfterMs;
}

/* ------------------------------------------------------------------------ */
/* Vessels                                                                   */
/* ------------------------------------------------------------------------ */

export type GeoClassification = "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL" | "SECRET";

export interface GeoVessel {
  mmsi: string;
  shipName: string | null;
  sourceClass: "AIS" | "GSM_TRACKER" | "SAT_TRACKER" | "APP_REPORT";
  /** Degrees, converted from the wire micro-degree integers. */
  latitude: number;
  longitude: number;
  speedKnots: number;
  courseDegrees: number;
  classification: GeoClassification;
  observedAt: string;
}

export interface VesselListResult {
  vessels: GeoVessel[];
}

const CLASSIFICATIONS: readonly GeoClassification[] = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL", "SECRET"];
const SOURCE_CLASSES: readonly GeoVessel["sourceClass"][] = ["AIS", "GSM_TRACKER", "SAT_TRACKER", "APP_REPORT"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be non-empty text`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be text when present`);
  }
  return value;
}

function requiredEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = record[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function validateVessel(candidate: unknown, context = "vessel"): GeoVessel {
  if (!isRecord(candidate)) {
    throw new Error(`${context} must be an object`);
  }
  const mmsi = requiredString(candidate, "mmsi");
  if (!/^[0-9]{9}$/.test(mmsi)) {
    throw new Error(`${context}.mmsi must be 9 digits`);
  }
  return {
    mmsi,
    shipName: optionalString(candidate, "shipName"),
    sourceClass: requiredEnum(candidate, "sourceClass", SOURCE_CLASSES),
    latitude: microsToDegrees(requiredInteger(candidate, "latitudeMicros")),
    longitude: microsToDegrees(requiredInteger(candidate, "longitudeMicros")),
    speedKnots: requiredInteger(candidate, "speedOverGroundMilliknots") / 1000,
    courseDegrees: requiredInteger(candidate, "courseOverGroundMillidegrees") / 1000,
    classification: requiredEnum(candidate, "classification", CLASSIFICATIONS),
    observedAt: requiredString(candidate, "observedAt"),
  };
}

export function validateVesselList(candidate: unknown): VesselListResult {
  if (!isRecord(candidate) || !Array.isArray(candidate.vessels)) {
    throw new Error("vessel response must be an object with a vessels array");
  }
  return { vessels: candidate.vessels.map((value, index) => validateVessel(value, `vessels[${index}]`)) };
}

/* ------------------------------------------------------------------------ */
/* Geofences (WP-10 versioned fences)                                        */
/* ------------------------------------------------------------------------ */

export interface GeoFence {
  geofenceId: string;
  version: number;
  name: string;
  classification: GeoClassification;
  state: string;
  /** Polygon ring as [lat, lon] degree pairs, converted from verticesMicros. */
  ring: [number, number][];
}

export interface GeoProvenance {
  source: string;
  asOf: string;
  stale: boolean;
  staleNote: string | null;
}

export interface FenceListResult {
  fences: GeoFence[];
  provenance: GeoProvenance | null;
}

function validateProvenance(candidate: unknown): GeoProvenance | null {
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (!isRecord(candidate)) {
    throw new Error("provenance must be an object");
  }
  return {
    source: requiredString(candidate, "source"),
    asOf: requiredString(candidate, "asOf"),
    stale: candidate.stale === true,
    staleNote: optionalString(candidate, "staleNote"),
  };
}

export function validateFenceList(candidate: unknown): FenceListResult {
  if (!isRecord(candidate) || !Array.isArray(candidate.fences)) {
    throw new Error("fence response must be an object with a fences array");
  }
  const fences = candidate.fences.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`fences[${index}] must be an object`);
    }
    const rawVertices = value.verticesMicros;
    if (!Array.isArray(rawVertices)) {
      throw new Error(`fences[${index}].verticesMicros must be an array`);
    }
    const ring: [number, number][] = rawVertices.map((vertex, vertexIndex) => {
      if (!Array.isArray(vertex) || vertex.length !== 2 || !Number.isInteger(vertex[0]) || !Number.isInteger(vertex[1])) {
        throw new Error(`fences[${index}].verticesMicros[${vertexIndex}] must be [latMicros, lonMicros] integers`);
      }
      return [microsToDegrees(vertex[0] as number), microsToDegrees(vertex[1] as number)];
    });
    return {
      geofenceId: requiredString(value, "geofenceId"),
      version: requiredInteger(value, "version"),
      name: requiredString(value, "name"),
      classification: requiredEnum(value, "classification", CLASSIFICATIONS),
      state: requiredString(value, "state"),
      ring,
    };
  });
  return { fences, provenance: validateProvenance(candidate.provenance) };
}

/* ------------------------------------------------------------------------ */
/* Congestion forecast                                                       */
/* ------------------------------------------------------------------------ */

export interface CongestionForecastPoint {
  step: number;
  atUnix: number;
  queueLength: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

export interface CongestionForecast {
  portCode: string;
  model: string;
  seasonalPeriod: number;
  trainedOn: number;
  points: CongestionForecastPoint[];
  backtestMAE: number;
  backtestMAPE: number;
  backtestNaiveMAE: number;
  backtestNaiveMAPE: number;
}

export interface CongestionForecastResult {
  port: string;
  forecast: CongestionForecast;
  modelDisclaimer: string;
  provenance: GeoProvenance | null;
}

/** Honest refusal state returned by the backend with HTTP 409. */
export interface InsufficientHistory {
  port: string;
  error: string;
  recordedObservations: number;
  model: string;
}

function finiteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

export function validateCongestionForecastResult(candidate: unknown): CongestionForecastResult {
  if (!isRecord(candidate)) {
    throw new Error("congestion forecast response must be an object");
  }
  const forecastCandidate = candidate.forecast;
  if (!isRecord(forecastCandidate)) {
    throw new Error("forecast must be an object");
  }
  if (!Array.isArray(forecastCandidate.points)) {
    throw new Error("forecast.points must be an array");
  }
  const points = forecastCandidate.points.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`forecast.points[${index}] must be an object`);
    }
    return {
      step: requiredInteger(value, "step"),
      atUnix: requiredInteger(value, "atUnix"),
      queueLength: finiteNumber(value, "queueLength"),
      lower80: finiteNumber(value, "lower80"),
      upper80: finiteNumber(value, "upper80"),
      lower95: finiteNumber(value, "lower95"),
      upper95: finiteNumber(value, "upper95"),
    };
  });
  const forecast: CongestionForecast = {
    portCode: requiredString(forecastCandidate, "portCode"),
    model: requiredString(forecastCandidate, "model"),
    seasonalPeriod: requiredInteger(forecastCandidate, "seasonalPeriod"),
    trainedOn: requiredInteger(forecastCandidate, "trainedOn"),
    points,
    backtestMAE: finiteNumber(forecastCandidate, "backtestMAE"),
    backtestMAPE: finiteNumber(forecastCandidate, "backtestMAPE"),
    backtestNaiveMAE: finiteNumber(forecastCandidate, "backtestNaiveMAE"),
    backtestNaiveMAPE: finiteNumber(forecastCandidate, "backtestNaiveMAPE"),
  };
  return {
    port: requiredString(candidate, "port"),
    forecast,
    modelDisclaimer: requiredString(candidate, "modelDisclaimer"),
    provenance: validateProvenance(candidate.provenance),
  };
}

/** Parse the backend's HTTP 409 INSUFFICIENT_HISTORY body. Returns null for anything else. */
export function parseInsufficientHistory(payload: Record<string, unknown> | undefined): InsufficientHistory | null {
  if (payload === undefined) {
    return null;
  }
  const error = payload.error;
  if (typeof error !== "string" || !error.includes("INSUFFICIENT_HISTORY")) {
    return null;
  }
  const recorded = payload.recordedObservations;
  return {
    port: typeof payload.port === "string" ? payload.port : "",
    error,
    recordedObservations: typeof recorded === "number" && Number.isInteger(recorded) ? recorded : 0,
    model: typeof payload.model === "string" ? payload.model : "",
  };
}

/* ------------------------------------------------------------------------ */
/* SOS / incident lifecycle                                                  */
/* ------------------------------------------------------------------------ */

export type SosState = "RAISED" | "ACKNOWLEDGED" | "RESOLVED";

export interface SosAlert {
  sosAlertId: string;
  reporterId: string;
  vesselReference: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  receivedAt: string;
  freeText: string | null;
  classification: GeoClassification;
  state: SosState;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface SosListResult {
  sosAlerts: SosAlert[];
}

const SOS_STATES: readonly SosState[] = ["RAISED", "ACKNOWLEDGED", "RESOLVED"];

export function validateSosAlert(candidate: unknown, context = "sosAlert"): SosAlert {
  if (!isRecord(candidate)) {
    throw new Error(`${context} must be an object`);
  }
  return {
    sosAlertId: requiredString(candidate, "sosAlertId"),
    reporterId: requiredString(candidate, "reporterId"),
    vesselReference: requiredString(candidate, "vesselReference"),
    latitude: microsToDegrees(requiredInteger(candidate, "latitudeMicros")),
    longitude: microsToDegrees(requiredInteger(candidate, "longitudeMicros")),
    recordedAt: requiredString(candidate, "recordedAt"),
    receivedAt: requiredString(candidate, "receivedAt"),
    freeText: optionalString(candidate, "freeText"),
    classification: requiredEnum(candidate, "classification", CLASSIFICATIONS),
    state: requiredEnum(candidate, "state", SOS_STATES),
    acknowledgedBy: optionalString(candidate, "acknowledgedBy"),
    acknowledgedAt: optionalString(candidate, "acknowledgedAt"),
    resolvedBy: optionalString(candidate, "resolvedBy"),
    resolvedAt: optionalString(candidate, "resolvedAt"),
  };
}

export function validateSosList(candidate: unknown): SosListResult {
  if (!isRecord(candidate) || !Array.isArray(candidate.sosAlerts)) {
    throw new Error("SOS response must be an object with a sosAlerts array");
  }
  return { sosAlerts: candidate.sosAlerts.map((value, index) => validateSosAlert(value, `sosAlerts[${index}]`)) };
}

/** Only RAISED/ACKNOWLEDGED alerts are live; RESOLVED is history. */
export function isLiveSos(alert: SosAlert): boolean {
  return alert.state !== "RESOLVED";
}

/* ------------------------------------------------------------------------ */
/* Transport                                                                 */
/* ------------------------------------------------------------------------ */

const GEO_TIMEOUT_MS = 15_000;

async function geoFetch(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    throw new GeoApiError("network", error instanceof Error ? error.message : "network request failed");
  } finally {
    clearTimeout(timeout);
  }
  let candidate: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      candidate = JSON.parse(text);
    } catch {
      throw new GeoApiError("invalid-payload", `response from ${path} was not valid JSON`);
    }
  }
  if (!response.ok) {
    const payload = isRecord(candidate) ? candidate : undefined;
    const backendError = payload !== undefined && typeof payload.error === "string" ? payload.error : null;
    throw new GeoApiError(
      "http",
      backendError ?? `request to ${path} failed with HTTP ${response.status}`,
      response.status,
      payload,
    );
  }
  return candidate;
}

function validated<T>(candidate: unknown, path: string, validate: (value: unknown) => T): T {
  try {
    return validate(candidate);
  } catch (error) {
    throw new GeoApiError("invalid-payload", error instanceof Error ? error.message : `response from ${path} failed validation`);
  }
}

export async function fetchVesselsInBbox(baseUrl: string, token: string, bbox: Bbox, limit = 1000): Promise<VesselListResult> {
  const path = `${GEO_ENDPOINTS.vessels}?bbox=${bboxToQuery(bbox)}&limit=${limit}`;
  return validated(await geoFetch(baseUrl, path, token), path, validateVesselList);
}

export async function fetchFences(baseUrl: string, token: string): Promise<FenceListResult> {
  return validated(await geoFetch(baseUrl, GEO_ENDPOINTS.fences, token), GEO_ENDPOINTS.fences, validateFenceList);
}

export async function fetchCongestionForecast(baseUrl: string, token: string, portCode: string, horizonHours = 24): Promise<CongestionForecastResult> {
  const code = portCode.trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(code)) {
    throw new GeoApiError("invalid-payload", "port code must be the 5-letter UN/LOCODE");
  }
  const path = `${GEO_ENDPOINTS.congestionForecast(code)}?horizonHours=${horizonHours}`;
  return validated(await geoFetch(baseUrl, path, token), path, validateCongestionForecastResult);
}

export async function fetchSosAlerts(baseUrl: string, token: string, limit = 100): Promise<SosListResult> {
  const path = `${GEO_ENDPOINTS.sos}?limit=${limit}`;
  return validated(await geoFetch(baseUrl, path, token), path, validateSosList);
}

async function sosLifecycle(baseUrl: string, token: string, path: string, note: string | null): Promise<SosAlert> {
  const body = note === null ? "{}" : JSON.stringify({ note });
  const candidate = await geoFetch(baseUrl, path, token, { method: "POST", body });
  return validated(candidate, path, (value) => {
    if (!isRecord(value) || value.sosAlert === undefined) {
      throw new Error("lifecycle response must carry the updated sosAlert");
    }
    return validateSosAlert(value.sosAlert);
  });
}

export function acknowledgeSos(baseUrl: string, token: string, id: string, note: string | null = null): Promise<SosAlert> {
  return sosLifecycle(baseUrl, token, GEO_ENDPOINTS.sosAcknowledge(id), note);
}

export function resolveSos(baseUrl: string, token: string, id: string, note: string | null = null): Promise<SosAlert> {
  return sosLifecycle(baseUrl, token, GEO_ENDPOINTS.sosResolve(id), note);
}
