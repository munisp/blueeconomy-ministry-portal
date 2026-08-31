// sar-client is the typed read boundary for the SAR C2 console against
// blueeconomy-maritime-intelligence (internal/server/sar_handlers.go and
// yaounde_handlers.go). It follows the portal's geo-client conventions:
// bearer token, no-store, abort timeouts, truthful error kinds
// (http/network/contract) and fail-closed response validation via
// sar-model parsers. Records that fail validation are dropped and counted;
// a wholly invalid envelope is a contract error. No response is ever
// substituted or fabricated.
import type { SarConsoleEndpoints } from "../endpoint-config";
import {
  parseSarCase,
  parseSarSitrep,
  parseSarTasking,
  parseSarTimelineEntry,
  parseYaoundeRelease,
  type SarCase,
  type SarPhase,
  type SarSitrep,
  type SarStage,
  type SarTasking,
  type SarTimelineEntry,
  type YaoundeRelease,
} from "./sar-model";

export type SarErrorKind = "http" | "network" | "contract";

export class SarApiError extends Error {
  readonly kind: SarErrorKind;
  readonly status: number | null;

  constructor(kind: SarErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "SarApiError";
    this.kind = kind;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

export interface SarCaseListResult {
  cases: SarCase[];
  dropped: number;
}

export interface SarTimelineResult {
  entries: SarTimelineEntry[];
  dropped: number;
}

export interface SarTaskingListResult {
  taskings: SarTasking[];
  dropped: number;
}

export interface SarSitrepListResult {
  sitreps: SarSitrep[];
  dropped: number;
}

export interface YaoundeReleaseListResult {
  releases: YaoundeRelease[];
  dropped: number;
}

export interface SarCaseFilters {
  stage?: SarStage;
  phase?: SarPhase;
}

function baseUrl(endpoints: SarConsoleEndpoints): string {
  return endpoints.sar_api_url.replace(/\/+$/, "");
}

async function sarFetch(endpoints: SarConsoleEndpoints, token: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl(endpoints)}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "request timed out" : error instanceof Error ? error.message : "network failure";
    throw new SarApiError("network", null, `maritime-intelligence service could not be reached (${reason})`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new SarApiError("http", response.status, `maritime-intelligence service returned HTTP ${response.status}`);
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SarApiError("contract", response.status, "maritime-intelligence service returned a non-JSON response");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseList<T>(candidate: unknown, key: string, status: number, parse: (item: unknown) => T | null, label: string): { items: T[]; dropped: number } {
  if (!isRecord(candidate) || !Array.isArray(candidate[key])) {
    throw new SarApiError("contract", status, `maritime-intelligence ${label} returned an unexpected response shape`);
  }
  const items: T[] = [];
  let dropped = 0;
  for (const item of candidate[key]) {
    const parsed = parse(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      items.push(parsed);
    }
  }
  return { items, dropped };
}

// listCases reads GET /v1/sar/cases with the API's stage/phase equality
// filters; records above the caller's clearance are already excluded
// server-side.
export async function listCases(endpoints: SarConsoleEndpoints, token: string, filters: SarCaseFilters = {}): Promise<SarCaseListResult> {
  const parameters = new URLSearchParams();
  if (filters.stage !== undefined) {
    parameters.set("stage", filters.stage);
  }
  if (filters.phase !== undefined) {
    parameters.set("phase", filters.phase);
  }
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
  const response = await sarFetch(endpoints, token, `/v1/sar/cases${suffix}`);
  const { items, dropped } = parseList(await readJson(response), "cases", response.status, parseSarCase, "case list");
  return { cases: items, dropped };
}

// getCase reads GET /v1/sar/cases/{caseID}; the backend returns 404 for an
// unknown case and 403 when the caller's clearance does not cover the
// record — both surface truthfully as http errors.
export async function getCase(endpoints: SarConsoleEndpoints, token: string, caseId: string): Promise<SarCase> {
  const response = await sarFetch(endpoints, token, `/v1/sar/cases/${encodeURIComponent(caseId)}`);
  const parsed = parseSarCase(await readJson(response));
  if (parsed === null) {
    throw new SarApiError("contract", response.status, "maritime-intelligence case detail returned an unexpected response shape");
  }
  return parsed;
}

// getTimeline reads GET /v1/sar/cases/{caseID}/timeline (the append-only
// case facts reconstructed from the maritime.sar.v1 event sequence).
export async function getTimeline(endpoints: SarConsoleEndpoints, token: string, caseId: string): Promise<SarTimelineResult> {
  const response = await sarFetch(endpoints, token, `/v1/sar/cases/${encodeURIComponent(caseId)}/timeline`);
  const { items, dropped } = parseList(await readJson(response), "entries", response.status, parseSarTimelineEntry, "case timeline");
  return { entries: items, dropped };
}

// listTaskings reads GET /v1/sar/cases/{caseID}/taskings.
export async function listTaskings(endpoints: SarConsoleEndpoints, token: string, caseId: string): Promise<SarTaskingListResult> {
  const response = await sarFetch(endpoints, token, `/v1/sar/cases/${encodeURIComponent(caseId)}/taskings`);
  const { items, dropped } = parseList(await readJson(response), "taskings", response.status, parseSarTasking, "tasking list");
  return { taskings: items, dropped };
}

// listSitreps reads GET /v1/sar/cases/{caseID}/sitrep (numbered, immutable
// SITREPs issued from retained case state).
export async function listSitreps(endpoints: SarConsoleEndpoints, token: string, caseId: string): Promise<SarSitrepListResult> {
  const response = await sarFetch(endpoints, token, `/v1/sar/cases/${encodeURIComponent(caseId)}/sitrep`);
  const { items, dropped } = parseList(await readJson(response), "sitreps", response.status, parseSarSitrep, "SITREP list");
  return { sitreps: items, dropped };
}

// listYaoundeReleases reads GET /v1/yaounde/releases (outbound regional
// incident-report releases). The console cross-links a SAR case to the
// releases recorded against the same incident reference.
export async function listYaoundeReleases(endpoints: SarConsoleEndpoints, token: string): Promise<YaoundeReleaseListResult> {
  const response = await sarFetch(endpoints, token, "/v1/yaounde/releases");
  const { items, dropped } = parseList(await readJson(response), "releases", response.status, parseYaoundeRelease, "Yaoundé release list");
  return { releases: items, dropped };
}
