// stats-client is the typed read boundary for the data-platform statistics
// API (blueeconomy-data-platform src/blueeconomy_data_platform/stats_api.py,
// routes rooted at /v1/stats). It follows the portal's geo-client
// conventions: bearer token, no-store, abort timeouts, truthful error kinds
// (http/network/contract) and fail-closed response validation via
// stats-model parsers. The API serves exact precomputed gold rows with
// run_id + source_table_versions provenance; this client never substitutes
// or fabricates a figure — an API failure surfaces as an error, never as
// fallback data.
import type { StatisticsEndpoints } from "../endpoint-config";
import {
  KPI_PERIOD_PATTERN,
  KPI_RUN_ID_PATTERN,
  KPI_UNLOCODE_PATTERN,
  parseKpiRegistry,
  parseStatsRun,
  parseStatsValue,
  type KpiRegistry,
  type StatsRunManifest,
  type StatsValueRow,
} from "./stats-model";

export type StatsErrorKind = "http" | "network" | "contract";

export class StatsApiError extends Error {
  readonly kind: StatsErrorKind;
  readonly status: number | null;

  constructor(kind: StatsErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "StatsApiError";
    this.kind = kind;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

export interface StatsRunListResult {
  runs: StatsRunManifest[];
  dropped: number;
}

export interface StatsValueListResult {
  values: StatsValueRow[];
  dropped: number;
}

export interface StatsValueFilters {
  kpi_id?: string;
  port_code?: string;
  period?: string;
}

function baseUrl(endpoints: StatisticsEndpoints): string {
  return endpoints.statistics_api_url.replace(/\/+$/, "");
}

async function statsFetch(endpoints: StatisticsEndpoints, token: string | null, path: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl(endpoints)}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "request timed out" : error instanceof Error ? error.message : "network failure";
    throw new StatsApiError("network", null, `statistics API could not be reached (${reason})`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new StatsApiError("http", response.status, `statistics API returned HTTP ${response.status}`);
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new StatsApiError("contract", response.status, "statistics API returned a non-JSON response");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// probeStatsHealth hits GET /v1/stats/health (unauthenticated liveness) so
// the dashboard can distinguish "service down" from "query failed".
export async function probeStatsHealth(endpoints: StatisticsEndpoints): Promise<boolean> {
  try {
    const response = await statsFetch(endpoints, null, "/health");
    return response.ok;
  } catch (error) {
    if (error instanceof StatsApiError && error.kind === "network") {
      return false;
    }
    // A non-2xx liveness response is still "unhealthy", not a query error.
    if (error instanceof StatsApiError && error.kind === "http") {
      return false;
    }
    return false;
  }
}

// getKpiRegistry reads GET /v1/stats/kpis: the pinned KPI definitions plus
// the documented statistics integration gaps. The registry is the
// authoritative list of what the platform publishes — the dashboard renders
// exactly these KPIs and never invents others.
export async function getKpiRegistry(endpoints: StatisticsEndpoints, token: string): Promise<KpiRegistry> {
  const response = await statsFetch(endpoints, token, "/kpis");
  const registry = parseKpiRegistry(await readJson(response));
  if (registry === null) {
    throw new StatsApiError("contract", response.status, "statistics API KPI registry returned an unexpected response shape");
  }
  return registry;
}

// listRuns reads GET /v1/stats/runs: the provenance ledger of published
// statistics runs (newest first per the API's ordering).
export async function listRuns(endpoints: StatisticsEndpoints, token: string): Promise<StatsRunListResult> {
  const response = await statsFetch(endpoints, token, "/runs");
  const candidate: unknown = await readJson(response);
  if (!isRecord(candidate) || !Array.isArray(candidate.runs)) {
    throw new StatsApiError("contract", response.status, "statistics API run ledger returned an unexpected response shape");
  }
  const runs: StatsRunManifest[] = [];
  let dropped = 0;
  for (const item of candidate.runs) {
    const parsed = parseStatsRun(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      runs.push(parsed);
    }
  }
  return { runs, dropped };
}

// queryValues reads GET /v1/stats/values with the API's equality filters.
// Filter values are validated against the API's own patterns before the
// call so an impossible filter fails locally instead of round-tripping.
export async function queryValues(endpoints: StatisticsEndpoints, token: string, filters: StatsValueFilters = {}): Promise<StatsValueListResult> {
  const parameters = new URLSearchParams();
  if (filters.kpi_id !== undefined) {
    parameters.set("kpi_id", filters.kpi_id);
  }
  if (filters.port_code !== undefined) {
    if (!KPI_UNLOCODE_PATTERN.test(filters.port_code)) {
      throw new StatsApiError("contract", null, "port_code filters must be UN/LOCODEs (5 upper-case letters)");
    }
    parameters.set("port_code", filters.port_code);
  }
  if (filters.period !== undefined) {
    if (!KPI_PERIOD_PATTERN.test(filters.period)) {
      throw new StatsApiError("contract", null, "period filters must match YYYY-MM");
    }
    parameters.set("period", filters.period);
  }
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
  const response = await statsFetch(endpoints, token, `/values${suffix}`);
  const candidate: unknown = await readJson(response);
  if (!isRecord(candidate) || !Array.isArray(candidate.values)) {
    throw new StatsApiError("contract", response.status, "statistics API values returned an unexpected response shape");
  }
  const values: StatsValueRow[] = [];
  let dropped = 0;
  for (const item of candidate.values) {
    const parsed = parseStatsValue(item);
    if (parsed === null) {
      dropped += 1;
    } else {
      values.push(parsed);
    }
  }
  return { values, dropped };
}

// Run report artefacts (GET /v1/stats/report/{run_id}?format=json) are the
// exact signed artefacts of one run; the dashboard links the run id and
// report digest from the ledger instead of re-serving the artefact inline.
export function reportPath(runId: string): string {
  if (!KPI_RUN_ID_PATTERN.test(runId)) {
    throw new StatsApiError("contract", null, "report lookups require a run UUID");
  }
  return `/report/${encodeURIComponent(runId)}?format=json`;
}
