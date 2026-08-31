// stats-model holds the typed, fail-closed model for the port & blue-
// economy statistics dashboard. The shapes mirror the data-platform
// statistics API (blueeconomy-data-platform
// src/blueeconomy_data_platform/stats_api.py) exactly: the KPI registry
// document, the run provenance manifests and the precomputed KPI value
// rows. Every parser validates the observed payload; a record that does
// not match the contract is dropped and counted, never rendered as truth.
// The API serves exact gold rows only — the dashboard never computes
// aggregates beyond the documented view transforms below.

// KPI_PERIOD_PATTERN mirrors PERIOD_PATTERN in port_statistics.py.
export const KPI_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// KPI_UNLOCODE_PATTERN mirrors UNLOCODE_PATTERN (5 upper-case letters).
export const KPI_UNLOCODE_PATTERN = /^[A-Z]{5}$/;
export const KPI_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const KPI_PERCENTILES = ["P50", "P90"] as const;
export type KpiPercentile = (typeof KPI_PERCENTILES)[number];

export interface KpiDefinitionEntry {
  kpi_id: string;
  name: string;
  definition: string;
  unit: string;
  definition_version: string;
  gap_id: string | null;
}

export interface StatsGapEntry {
  gap_id: string;
  description: string;
  needed_upstream: string;
}

export interface KpiRegistry {
  kpis: KpiDefinitionEntry[];
  gaps: StatsGapEntry[];
}

export interface StatsRunManifest {
  run_id: string;
  computed_at: string;
  period: string;
  period_start: string;
  period_end: string;
  scope: string;
  source_table_versions: Record<string, number>;
  query_definitions_sha256: string;
  kpi_count: number;
  rows_emitted: number;
  rows_no_data: number;
  report_sha256: string;
}

// StatsValueRow is one exact precomputed gold row. `value` is null for a
// first-class no-data row (zero observations or a blocked KPI), with
// `coverage_note` carrying the honest explanation — the dashboard renders
// the note, never a substitute figure.
export interface StatsValueRow {
  run_id: string;
  kpi_id: string;
  period: string;
  port_code: string | null;
  ship_class: string | null;
  value: number | null;
  unit: string;
  n_observations: number;
  percentile: KpiPercentile | null;
  coverage_note: string | null;
  definition_version: string;
  source_table: string;
  table_version: number;
  query_hash: string;
  computed_at: string;
  source_table_versions: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requiredIsoInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function requiredInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  return undefined;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

// parseTableVersions validates the {"table": version} provenance map.
function parseTableVersions(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, version] of Object.entries(value)) {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
      return null;
    }
    result[key] = version;
  }
  return result;
}

export function parseKpiRegistry(candidate: unknown): KpiRegistry | null {
  if (!isRecord(candidate) || !Array.isArray(candidate.kpis) || !Array.isArray(candidate.gaps)) {
    return null;
  }
  const kpis: KpiDefinitionEntry[] = [];
  for (const item of candidate.kpis) {
    if (!isRecord(item)) {
      return null;
    }
    const kpiId = requiredText(item.kpi_id);
    const name = requiredText(item.name);
    const definition = requiredText(item.definition);
    const unit = requiredText(item.unit);
    const definitionVersion = requiredText(item.definition_version);
    const gapId = nullableText(item.gap_id ?? null);
    if (kpiId === null || name === null || definition === null || unit === null || definitionVersion === null || gapId === undefined) {
      return null;
    }
    kpis.push({ kpi_id: kpiId, name, definition, unit, definition_version: definitionVersion, gap_id: gapId });
  }
  const gaps: StatsGapEntry[] = [];
  for (const item of candidate.gaps) {
    if (!isRecord(item)) {
      return null;
    }
    const gapId = requiredText(item.gap_id);
    const description = requiredText(item.description);
    const neededUpstream = requiredText(item.needed_upstream);
    if (gapId === null || description === null || neededUpstream === null) {
      return null;
    }
    gaps.push({ gap_id: gapId, description, needed_upstream: neededUpstream });
  }
  return { kpis, gaps };
}

export function parseStatsRun(candidate: unknown): StatsRunManifest | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const runId = requiredText(candidate.run_id);
  const computedAt = requiredIsoInstant(candidate.computed_at);
  const period = requiredText(candidate.period);
  const periodStart = requiredIsoInstant(candidate.period_start);
  const periodEnd = requiredIsoInstant(candidate.period_end);
  const scope = requiredText(candidate.scope);
  const sourceTableVersions = parseTableVersions(candidate.source_table_versions);
  const queryDefinitionsSha256 = requiredText(candidate.query_definitions_sha256);
  const kpiCount = requiredInteger(candidate.kpi_count);
  const rowsEmitted = requiredInteger(candidate.rows_emitted);
  const rowsNoData = requiredInteger(candidate.rows_no_data);
  const reportSha256 = requiredText(candidate.report_sha256);
  if (runId === null || !KPI_RUN_ID_PATTERN.test(runId) || computedAt === null || period === null || !KPI_PERIOD_PATTERN.test(period) || periodStart === null || periodEnd === null || scope === null || sourceTableVersions === null || queryDefinitionsSha256 === null || kpiCount === null || rowsEmitted === null || rowsNoData === null || reportSha256 === null) {
    return null;
  }
  return {
    run_id: runId,
    computed_at: computedAt,
    period,
    period_start: periodStart,
    period_end: periodEnd,
    scope,
    source_table_versions: sourceTableVersions,
    query_definitions_sha256: queryDefinitionsSha256,
    kpi_count: kpiCount,
    rows_emitted: rowsEmitted,
    rows_no_data: rowsNoData,
    report_sha256: reportSha256,
  };
}

export function parseStatsValue(candidate: unknown): StatsValueRow | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const runId = requiredText(candidate.run_id);
  const kpiId = requiredText(candidate.kpi_id);
  const period = requiredText(candidate.period);
  const portCode = nullableText(candidate.port_code ?? null);
  const shipClass = nullableText(candidate.ship_class ?? null);
  const value = nullableFiniteNumber(candidate.value ?? null);
  const unit = requiredText(candidate.unit);
  const nObservations = requiredInteger(candidate.n_observations);
  const percentile = candidate.percentile === null || candidate.percentile === undefined ? null : KPI_PERCENTILES.find((entry) => entry === candidate.percentile) ?? undefined;
  const coverageNote = nullableText(candidate.coverage_note ?? null);
  const definitionVersion = requiredText(candidate.definition_version);
  const sourceTable = requiredText(candidate.source_table);
  const tableVersion = requiredInteger(candidate.table_version);
  const queryHash = requiredText(candidate.query_hash);
  const computedAt = requiredIsoInstant(candidate.computed_at);
  const sourceTableVersions = parseTableVersions(candidate.source_table_versions);
  if (runId === null || kpiId === null || period === null || !KPI_PERIOD_PATTERN.test(period) || portCode === undefined || shipClass === undefined || value === undefined || unit === null || nObservations === null || percentile === undefined || coverageNote === undefined || definitionVersion === null || sourceTable === null || tableVersion === null || queryHash === null || computedAt === null || sourceTableVersions === null) {
    return null;
  }
  return {
    run_id: runId,
    kpi_id: kpiId,
    period,
    port_code: portCode,
    ship_class: shipClass,
    value,
    unit,
    n_observations: nObservations,
    percentile,
    coverage_note: coverageNote,
    definition_version: definitionVersion,
    source_table: sourceTable,
    table_version: tableVersion,
    query_hash: queryHash,
    computed_at: computedAt,
    source_table_versions: sourceTableVersions,
  };
}

// formatKpiValue renders one observed value with its unit; no-data rows are
// rendered by the caller from the coverage note.
export function formatKpiValue(row: StatsValueRow): string {
  if (row.value === null) {
    return "No data";
  }
  const rounded = Math.abs(row.value) >= 100 ? row.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : row.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${rounded} ${row.unit}`;
}

// segmentLabel describes one row's port/segment slice truthfully: a null
// port_code is the API's whole-scope (national) row and a null ship_class
// is the all-classes segment, exactly as the gold rollup emits them.
export function segmentLabel(row: StatsValueRow): string {
  const port = row.port_code ?? "National (all ports)";
  const ship = row.ship_class ?? "all ship classes";
  const percentile = row.percentile ?? "total";
  return `${port} · ${ship} · ${percentile}`;
}
