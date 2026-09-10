import { apiGet, apiGetSignedBlob, type SignedBlob } from "./api-client";

/**
 * Ministerial KPI data layer. Every function performs a live, authorised
 * request against the approved backend and validates the payload before it
 * reaches the UI. Nothing here fabricates numbers: transport failures and
 * malformed payloads surface as ApiError and the pages render an error
 * state (fail-closed).
 */

export const KPI_ENDPOINTS = {
  executiveSummary: "/v1/executive/kpi-summary",
  operationalKpis: "/v1/executive/operational-kpis",
  tradeAnalytics: "/v1/analytics/trade",
  riskModelMetrics: "/v1/risk/model-metrics",
  slaBreaches: "/v1/sla/breaches",
  customsSummary: "/v1/customs/summary",
  weeklyBriefing: "/v1/briefings/weekly",
  portPerformanceReport: "/v1/port-performance/report",
  portPerformanceReportPdf: "/v1/port-performance/report.pdf",
  // Phase 18: RL queue-policy shadow status (singlewindow honest endpoint)
  rlQueuePolicyStatus: "/v1/rl/queue-policy/status",
} as const;

export interface MinisterialKpiPack {
  period_start: string;
  period_end: string;
  revenue_collected_ngn: number;
  declarations_cleared: number;
  avg_clearance_hours: number;
  interceptions: number;
  coverage_pct: number;
  sla_compliance_pct: number;
}

export type OperationalKpiStatus = "on-track" | "at-risk" | "breach";

export interface OperationalKpiEntry {
  id: string;
  label: string;
  value: number;
  unit: string;
  target: number | null;
  status: OperationalKpiStatus;
}

export interface OperationalKpiReport {
  generated_at: string;
  entries: OperationalKpiEntry[];
}

export interface TradeAnalyticsReport {
  window_days: number;
  total_declarations: number;
  total_duty_ngn: number;
  top_hs_chapters: { chapter: string; declarations: number; duty_ngn: number }[];
  daily: { date: string; declarations: number; duty_ngn: number }[];
}

export interface RiskModelMetrics {
  model_version: string;
  evaluated_at: string;
  auc: number;
  precision: number;
  recall: number;
  alerts_generated: number;
  hit_rate_pct: number;
}

export type SlaBreachSeverity = "warning" | "critical";

export interface SlaBreachReport {
  generated_at: string;
  breaches: {
    service: string;
    stage: string;
    sla_hours: number;
    elapsed_hours: number;
    severity: SlaBreachSeverity;
    reference: string;
  }[];
}

export interface CustomsSummaryReport {
  generated_at: string;
  agencies: {
    agency: string;
    revenue_collected_ngn: number;
    declarations_processed: number;
    interceptions: number;
    compliance_pct: number;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
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

function requiredArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value;
}

export function validateMinisterialKpiPack(candidate: unknown): MinisterialKpiPack {
  if (!isRecord(candidate)) {
    throw new Error("kpi summary must be an object");
  }
  return {
    period_start: requiredString(candidate, "period_start"),
    period_end: requiredString(candidate, "period_end"),
    revenue_collected_ngn: requiredNumber(candidate, "revenue_collected_ngn"),
    declarations_cleared: requiredNumber(candidate, "declarations_cleared"),
    avg_clearance_hours: requiredNumber(candidate, "avg_clearance_hours"),
    interceptions: requiredNumber(candidate, "interceptions"),
    coverage_pct: requiredNumber(candidate, "coverage_pct"),
    sla_compliance_pct: requiredNumber(candidate, "sla_compliance_pct"),
  };
}

export function validateOperationalKpiReport(candidate: unknown): OperationalKpiReport {
  if (!isRecord(candidate)) {
    throw new Error("operational kpi report must be an object");
  }
  const entries = requiredArray(candidate, "entries").map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`entries[${index}] must be an object`);
    }
    const status = value.status;
    if (status !== "on-track" && status !== "at-risk" && status !== "breach") {
      throw new Error(`entries[${index}].status must be on-track, at-risk or breach`);
    }
    const kpiStatus: OperationalKpiStatus = status;
    const target = value.target;
    if (target !== null && target !== undefined && (typeof target !== "number" || !Number.isFinite(target))) {
      throw new Error(`entries[${index}].target must be a finite number or null`);
    }
    return {
      id: requiredString(value, "id"),
      label: requiredString(value, "label"),
      value: requiredNumber(value, "value"),
      unit: requiredString(value, "unit"),
      target: target ?? null,
      status: kpiStatus,
    };
  });
  return { generated_at: requiredString(candidate, "generated_at"), entries };
}

export function validateTradeAnalyticsReport(candidate: unknown): TradeAnalyticsReport {
  if (!isRecord(candidate)) {
    throw new Error("trade analytics report must be an object");
  }
  const topHsChapters = requiredArray(candidate, "top_hs_chapters").map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`top_hs_chapters[${index}] must be an object`);
    }
    return {
      chapter: requiredString(value, "chapter"),
      declarations: requiredNumber(value, "declarations"),
      duty_ngn: requiredNumber(value, "duty_ngn"),
    };
  });
  const daily = requiredArray(candidate, "daily").map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`daily[${index}] must be an object`);
    }
    return {
      date: requiredString(value, "date"),
      declarations: requiredNumber(value, "declarations"),
      duty_ngn: requiredNumber(value, "duty_ngn"),
    };
  });
  return {
    window_days: requiredNumber(candidate, "window_days"),
    total_declarations: requiredNumber(candidate, "total_declarations"),
    total_duty_ngn: requiredNumber(candidate, "total_duty_ngn"),
    top_hs_chapters: topHsChapters,
    daily,
  };
}

export function validateRiskModelMetrics(candidate: unknown): RiskModelMetrics {
  if (!isRecord(candidate)) {
    throw new Error("risk model metrics must be an object");
  }
  return {
    model_version: requiredString(candidate, "model_version"),
    evaluated_at: requiredString(candidate, "evaluated_at"),
    auc: requiredNumber(candidate, "auc"),
    precision: requiredNumber(candidate, "precision"),
    recall: requiredNumber(candidate, "recall"),
    alerts_generated: requiredNumber(candidate, "alerts_generated"),
    hit_rate_pct: requiredNumber(candidate, "hit_rate_pct"),
  };
}

export function validateSlaBreachReport(candidate: unknown): SlaBreachReport {
  if (!isRecord(candidate)) {
    throw new Error("sla breach report must be an object");
  }
  const breaches = requiredArray(candidate, "breaches").map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`breaches[${index}] must be an object`);
    }
    const severity = value.severity;
    if (severity !== "warning" && severity !== "critical") {
      throw new Error(`breaches[${index}].severity must be warning or critical`);
    }
    const breachSeverity: SlaBreachSeverity = severity;
    return {
      service: requiredString(value, "service"),
      stage: requiredString(value, "stage"),
      sla_hours: requiredNumber(value, "sla_hours"),
      elapsed_hours: requiredNumber(value, "elapsed_hours"),
      severity: breachSeverity,
      reference: requiredString(value, "reference"),
    };
  });
  return { generated_at: requiredString(candidate, "generated_at"), breaches };
}

export function validateCustomsSummaryReport(candidate: unknown): CustomsSummaryReport {
  if (!isRecord(candidate)) {
    throw new Error("customs summary must be an object");
  }
  const agencies = requiredArray(candidate, "agencies").map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`agencies[${index}] must be an object`);
    }
    return {
      agency: requiredString(value, "agency"),
      revenue_collected_ngn: requiredNumber(value, "revenue_collected_ngn"),
      declarations_processed: requiredNumber(value, "declarations_processed"),
      interceptions: requiredNumber(value, "interceptions"),
      compliance_pct: requiredNumber(value, "compliance_pct"),
    };
  });
  return { generated_at: requiredString(candidate, "generated_at"), agencies };
}

export function fetchMinisterialKpiPack(baseUrl: string, token: string): Promise<MinisterialKpiPack> {
  return apiGet(baseUrl, KPI_ENDPOINTS.executiveSummary, token, validateMinisterialKpiPack);
}

export function fetchOperationalKpis(baseUrl: string, token: string): Promise<OperationalKpiReport> {
  return apiGet(baseUrl, KPI_ENDPOINTS.operationalKpis, token, validateOperationalKpiReport);
}

export function fetchTradeAnalytics(baseUrl: string, token: string, windowDays = 30): Promise<TradeAnalyticsReport> {
  return apiGet(baseUrl, `${KPI_ENDPOINTS.tradeAnalytics}?days=${windowDays}`, token, validateTradeAnalyticsReport);
}

export function fetchRiskModelMetrics(baseUrl: string, token: string): Promise<RiskModelMetrics> {
  return apiGet(baseUrl, KPI_ENDPOINTS.riskModelMetrics, token, validateRiskModelMetrics);
}

export function fetchSlaBreaches(baseUrl: string, token: string): Promise<SlaBreachReport> {
  return apiGet(baseUrl, KPI_ENDPOINTS.slaBreaches, token, validateSlaBreachReport);
}

export function fetchCustomsSummary(baseUrl: string, token: string): Promise<CustomsSummaryReport> {
  return apiGet(baseUrl, KPI_ENDPOINTS.customsSummary, token, validateCustomsSummaryReport);
}

export function fetchWeeklyBriefing(baseUrl: string, token: string): Promise<SignedBlob> {
  return apiGetSignedBlob(baseUrl, KPI_ENDPOINTS.weeklyBriefing, token);
}

/* ------------------------------------------------------------------------ */
/* Port performance report (NPA-style)                                      */
/* ------------------------------------------------------------------------ */

export type PortPerformancePeriod = "weekly" | "monthly" | "quarterly";

export const PORT_PERFORMANCE_PERIODS: readonly PortPerformancePeriod[] = ["weekly", "monthly", "quarterly"];

/**
 * A single port-performance indicator. `source` names the real backend data
 * query the figure is aggregated from; `value` is null when that source
 * returned no records for the period (the UI must render an explicit
 * "no data" state, never a fabricated figure). `delta_pct` is the
 * period-over-period change and is null when no comparable previous period
 * exists.
 */
export interface PortPerformanceMetric {
  source: string;
  value: number | null;
  delta_pct: number | null;
  unit: string;
}

export interface PortPerformanceMetrics {
  cargo_throughput_tonnes: PortPerformanceMetric;
  vessel_calls: PortPerformanceMetric;
  teu_in: PortPerformanceMetric;
  teu_out: PortPerformanceMetric;
  transshipment_volume_teu: PortPerformanceMetric;
  export_tonnes: PortPerformanceMetric;
  import_tonnes: PortPerformanceMetric;
}

export interface PortPerformanceReport {
  generated_at: string;
  period: PortPerformancePeriod;
  period_start: string;
  period_end: string;
  metrics: PortPerformanceMetrics;
}

export const PORT_PERFORMANCE_METRIC_LABELS: Record<keyof PortPerformanceMetrics, string> = {
  cargo_throughput_tonnes: "Total cargo throughput",
  vessel_calls: "Vessel calls",
  teu_in: "TEU in",
  teu_out: "TEU out",
  transshipment_volume_teu: "Transshipment volume",
  export_tonnes: "Export tonnage",
  import_tonnes: "Import tonnage",
};

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number or null`);
  }
  return value;
}

function validatePortPerformanceMetric(candidate: unknown, key: string): PortPerformanceMetric {
  if (!isRecord(candidate)) {
    throw new Error(`metrics.${key} must be an object`);
  }
  return {
    source: requiredString(candidate, "source"),
    value: nullableNumber(candidate, "value"),
    delta_pct: nullableNumber(candidate, "delta_pct"),
    unit: requiredString(candidate, "unit"),
  };
}

export function validatePortPerformanceReport(candidate: unknown): PortPerformanceReport {
  if (!isRecord(candidate)) {
    throw new Error("port performance report must be an object");
  }
  const period = candidate.period;
  if (period !== "weekly" && period !== "monthly" && period !== "quarterly") {
    throw new Error("period must be weekly, monthly or quarterly");
  }
  const reportPeriod: PortPerformancePeriod = period;
  const metricsCandidate = candidate.metrics;
  if (!isRecord(metricsCandidate)) {
    throw new Error("metrics must be an object");
  }
  const metrics: PortPerformanceMetrics = {
    cargo_throughput_tonnes: validatePortPerformanceMetric(metricsCandidate.cargo_throughput_tonnes, "cargo_throughput_tonnes"),
    vessel_calls: validatePortPerformanceMetric(metricsCandidate.vessel_calls, "vessel_calls"),
    teu_in: validatePortPerformanceMetric(metricsCandidate.teu_in, "teu_in"),
    teu_out: validatePortPerformanceMetric(metricsCandidate.teu_out, "teu_out"),
    transshipment_volume_teu: validatePortPerformanceMetric(metricsCandidate.transshipment_volume_teu, "transshipment_volume_teu"),
    export_tonnes: validatePortPerformanceMetric(metricsCandidate.export_tonnes, "export_tonnes"),
    import_tonnes: validatePortPerformanceMetric(metricsCandidate.import_tonnes, "import_tonnes"),
  };
  return {
    generated_at: requiredString(candidate, "generated_at"),
    period: reportPeriod,
    period_start: requiredString(candidate, "period_start"),
    period_end: requiredString(candidate, "period_end"),
    metrics,
  };
}

/**
 * Export/import balance derived from the two real tonnage figures. Returns
 * null when either leg has no data for the period — the UI renders an
 * honest unavailable state rather than an arithmetic guess.
 */
export function exportImportBalanceTonnes(metrics: PortPerformanceMetrics): number | null {
  if (metrics.export_tonnes.value === null || metrics.import_tonnes.value === null) {
    return null;
  }
  return metrics.export_tonnes.value - metrics.import_tonnes.value;
}

export function fetchPortPerformanceReport(
  baseUrl: string,
  token: string,
  period: PortPerformancePeriod,
): Promise<PortPerformanceReport> {
  return apiGet(baseUrl, `${KPI_ENDPOINTS.portPerformanceReport}?period=${period}`, token, validatePortPerformanceReport);
}

export function fetchPortPerformanceReportPdf(
  baseUrl: string,
  token: string,
  period: PortPerformancePeriod,
): Promise<SignedBlob> {
  return apiGetSignedBlob(baseUrl, `${KPI_ENDPOINTS.portPerformanceReportPdf}?period=${period}`, token);
}

/* ------------------------------------------------------------------------ */
/* RL queue-policy shadow status (Phase 18)                                  */
/* ------------------------------------------------------------------------ */

/**
 * Honest status of the singlewindow RL queue-policy shadow surface, served
 * by GET /v1/rl/queue-policy/status. "Untrained" is a first-class payload
 * (trained:false), not an error — the card renders it like the congestion
 * card's insufficient-history state. Transport failures and 503s surface
 * as ApiError and render the error state (fail-closed).
 */
export interface RlQueuePolicyStatus {
  surface: string;
  trained: boolean;
  policyVersion: string | null;
  opeScore: number | null;
  mode: "shadow" | null;
  note: string;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number when present`);
  }
  return value;
}

function optionalText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be text when present`);
  }
  return value;
}

export function validateRlQueuePolicyStatus(candidate: unknown): RlQueuePolicyStatus {
  if (!isRecord(candidate)) {
    throw new Error("queue-policy status must be an object");
  }
  if (candidate.status !== "ok") {
    throw new Error("queue-policy status must report status ok (down surfaces as an HTTP error)");
  }
  if (typeof candidate.trained !== "boolean") {
    throw new Error("trained must be a boolean");
  }
  const mode = candidate.mode;
  if (mode !== null && mode !== undefined && mode !== "shadow") {
    // RL output is advisory only — a non-shadow mode is never displayed.
    throw new Error('mode must be "shadow" or null');
  }
  return {
    surface: requiredString(candidate, "surface"),
    trained: candidate.trained,
    policyVersion: optionalText(candidate, "policyVersion"),
    opeScore: optionalNumber(candidate, "opeScore"),
    mode: mode === "shadow" ? "shadow" : null,
    note: requiredString(candidate, "note"),
  };
}

export function fetchRlQueuePolicyStatus(baseUrl: string, token: string): Promise<RlQueuePolicyStatus> {
  return apiGet(baseUrl, KPI_ENDPOINTS.rlQueuePolicyStatus, token, validateRlQueuePolicyStatus);
}
