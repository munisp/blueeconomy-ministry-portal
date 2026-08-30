// Revenue domain model for the ministry revenue dashboards (W-FEAT-9).
//
// Every type here mirrors an upstream response DTO recorded from the service
// ODBs, and every helper is pure so the honesty rules (endpoint-down vs
// no-data, agency dimension from DATA, provenance on every figure) are
// unit-tested instead of asserted:
//   - ferry-ticketing @ df6c147: internal/fare/store_settlement.go
//     (SettlementAggregate, SubsidyLine), internal/httpapi/fare_handlers.go
//     (GET /v1/reports/settlement, GET /v1/reports/subsidy).
//   - financial-controls @ 3bff518: internal/tariff/model.go (Assessment,
//     AssessmentLine) and store.go (RateRow, ExemptionAudit serialise with
//     capitalised Go field names — the DTOs below match the wire exactly).
//   - port-interoperability @ df9ed45: internal/booking/model.go (Booking).
//
// FAIL-CLOSED: nothing in this module invents figures. Absent endpoints are
// declared as integration gaps; absent records are a no-data state, never a
// zero.

/** Agencies tracked by the ministry dashboards. The agency dimension is read
 * from upstream DATA fields (tariff RateRow.Agency, AssessmentLine.Agency);
 * an agency with no data-producing endpoint renders an honest gap card. */
export const AGENCIES = ["NPA", "NIMASA", "NIWA", "FMMBE", "CBN"] as const;
export type Agency = (typeof AGENCIES)[number];

export function isAgency(value: string): value is Agency {
  return (AGENCIES as readonly string[]).includes(value);
}

// Roles that may read the revenue dashboards client-side, mirroring the
// ferry-ticketing report route policy (internal/httpapi/fare_handlers.go:
// GET /v1/reports/*). The tariff engine authenticates any verified subject
// and port-interoperability scopes reads by tenancy; the backends remain the
// authoritative enforcers — this guard only decides what the portal renders.
export const REVENUE_READER_ROLES: readonly string[] = [
  "state-officer",
  "niwa-officer",
  "nimasa-observer",
  "independent-auditor",
  "auditor",
  "fmmbe-oversight",
];

export function isRevenueReader(roles: ReadonlySet<string>): boolean {
  return REVENUE_READER_ROLES.some((role) => roles.has(role));
}

/* -------------------------------------------------------------------------
 * ferry-ticketing (BlueFare) report DTOs — snake_case JSON tags as recorded.
 * ------------------------------------------------------------------------- */

/** SettlementAggregate: GET /v1/reports/settlement?operatorId&from&to. */
export interface SettlementAggregate {
  operatorId: string;
  periodStart: string;
  periodEnd: string;
  rides: number;
  grossNgnMinor: number;
  subsidyNgnMinor: number;
  operatorShareBps: number;
  operatorShareNgnMinor: number;
  platformShareNgnMinor: number;
}

/** SubsidyLine: one route row inside GET /v1/reports/subsidy {"routes": []}. */
export interface SubsidyLine {
  routeReference: string;
  rides: number;
  standardFareNgnMinor: number;
  chargedNgnMinor: number;
  subsidyNgnMinor: number;
}

export interface SubsidyReport {
  routes: SubsidyLine[];
}

/* -------------------------------------------------------------------------
 * financial-controls tariff engine DTOs. Assessment/AssessmentLine carry
 * snake_case JSON tags; RateRow and ExemptionAudit serialise with their
 * capitalised Go field names (no json tags in internal/tariff/model.go).
 * ------------------------------------------------------------------------- */

export interface TariffRateRow {
  RateID: string;
  Instrument: string;
  Agency: string;
  BandLogic: string;
  Currency: string;
  RateMinorPerUnit: number;
  RateBps: number;
  BandFloor: number;
  BandCeiling: number | null;
  StatutoryReference: string;
  Provisional: boolean;
  EffectiveFrom: string;
  EffectiveTo: string | null;
  State: string;
  Maker: string;
  Checker: string;
}

export interface TariffRateList {
  rates: TariffRateRow[];
}

export interface AssessmentLine {
  lineNo: number;
  instrument: string;
  agency: string;
  applicability: string; // CHARGED | EXEMPT | NOT_APPLICABLE | UNRATED
  basis: string;
  statutoryReference?: string;
  rateDescription?: string;
  amountMinor: number;
  currency: string;
  exemptionId?: string;
  provisional?: boolean;
}

export interface Assessment {
  assessmentId: string;
  asOf: string;
  lines: AssessmentLine[];
  totalUsdMinor: number;
  totalNgnMinor: number;
  requester: string;
  correlationId: string;
  createdAt: string;
}

export interface ExemptionAudit {
  AuditID: string;
  AssessmentID: string;
  ExemptionID: string;
  Instrument: string;
  MatchKind: string;
  MatchValue: string;
  StatutoryBasis: string;
  EvidenceRequirement: string;
  Requester: string;
  CreatedAt: string;
}

export interface ExemptionAuditList {
  audits: ExemptionAudit[];
}

/* -------------------------------------------------------------------------
 * port-interoperability booking DTO (payment receipt / refund state).
 * ------------------------------------------------------------------------- */

export interface BookingRecord {
  booking_id: string;
  tenant_id: string;
  request_id: string;
  terminal_id: string;
  channel: string;
  status: string; // includes PAID and REFUNDED terminal states
  amount_kobo: number;
  currency: string;
  created_by?: string;
  operator_id?: string;
  payment_receipt_ref?: string;
  ledger_commit_hash?: string;
  reconciliation_reason?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  version: number;
}

/* -------------------------------------------------------------------------
 * Provenance: every figure on a dashboard names the exact upstream call it
 * came from. Aggregates link to their record list through these descriptors;
 * where the upstream exposes no record list the descriptor says so instead
 * of fabricating a link.
 * ------------------------------------------------------------------------- */

export type RevenueServiceId = "ferry-ticketing" | "financial-controls" | "port-interoperability";

export interface Provenance {
  service: RevenueServiceId;
  method: "GET";
  path: string;
}

export function subsidyReportProvenance(from: string, to: string): Provenance {
  return { service: "ferry-ticketing", method: "GET", path: `/v1/reports/subsidy?from=${from}&to=${to}` };
}

export function settlementReportProvenance(operatorId: string, from: string, to: string): Provenance {
  return { service: "ferry-ticketing", method: "GET", path: `/v1/reports/settlement?operatorId=${encodeURIComponent(operatorId)}&from=${from}&to=${to}` };
}

export function tariffRatesProvenance(): Provenance {
  return { service: "financial-controls", method: "GET", path: "/v1/tariffs/rates" };
}

export function assessmentProvenance(assessmentId: string): Provenance {
  return { service: "financial-controls", method: "GET", path: `/v1/tariffs/assessments/${encodeURIComponent(assessmentId)}` };
}

export function exemptionAuditsProvenance(assessmentId: string): Provenance {
  return { service: "financial-controls", method: "GET", path: `/v1/tariffs/assessments/${encodeURIComponent(assessmentId)}/exemption-audits` };
}

export function bookingReceiptProvenance(bookingId: string): Provenance {
  return { service: "port-interoperability", method: "GET", path: `/v1/bookings/${encodeURIComponent(bookingId)}` };
}

export function describeProvenance(provenance: Provenance): string {
  return `${provenance.service} ${provenance.method} ${provenance.path}`;
}

/* -------------------------------------------------------------------------
 * Date-range handling. The ferry report endpoints treat `to` as EXCLUSIVE
 * ([from, to) over YYYY-MM-DD); the dashboards present an inclusive end
 * date, so the client adds one day before calling. Validation is fail-closed.
 * ------------------------------------------------------------------------- */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  /** Inclusive start, YYYY-MM-DD. */
  from: string;
  /** Inclusive end as chosen by the analyst, YYYY-MM-DD. */
  toInclusive: string;
  /** Exclusive end sent to the upstream endpoints, YYYY-MM-DD. */
  toExclusive: string;
}

export function resolveDateRange(from: string, toInclusive: string): DateRange | string {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(toInclusive)) {
    return "dates must be YYYY-MM-DD";
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${toInclusive}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "dates must be valid calendar dates";
  }
  if (end < start) {
    return "the end date must not precede the start date";
  }
  const exclusive = new Date(end + 86_400_000).toISOString().slice(0, 10);
  return { from, toInclusive, toExclusive: exclusive };
}

/** A monthly bucket of an inclusive range; `toExclusive` is the first day
 * after the bucket (or after the range end inside the final bucket). */
export interface MonthBucket {
  label: string; // e.g. "2026-07"
  from: string;
  toExclusive: string;
}

// monthBuckets splits an inclusive date range into calendar-month query
// windows for the period-scoped report endpoints. The series is real: each
// point is one authorised upstream call, never an interpolation.
export function monthBuckets(range: DateRange): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  let cursor = new Date(Date.parse(`${range.from}T00:00:00Z`));
  const last = new Date(Date.parse(`${range.toInclusive}T00:00:00Z`));
  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 62) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const bucketStart = cursor.toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const bucketLast = monthEnd.getTime() < last.getTime() ? monthEnd : last;
    buckets.push({
      label: `${year}-${String(month + 1).padStart(2, "0")}`,
      from: bucketStart,
      toExclusive: new Date(bucketLast.getTime() + 86_400_000).toISOString().slice(0, 10),
    });
    cursor = new Date(Date.UTC(year, month + 1, 1));
    guard += 1;
  }
  return buckets;
}

/* -------------------------------------------------------------------------
 * Agency dimension: derived from DATA fields, never assumed. The tariff
 * rate registry and assessment lines carry an explicit agency code; the
 * BlueFare reports carry operator/route dimensions instead, so no agency is
 * attributed to them.
 * ------------------------------------------------------------------------- */

/** filterRatesByAgency keeps rate rows whose data-carried agency matches;
 * "ALL" keeps every row. Unknown agency codes in the data are preserved when
 * unfiltered — they are observed records, not validation failures. */
export function filterRatesByAgency(rates: readonly TariffRateRow[], agency: Agency | "ALL"): TariffRateRow[] {
  if (agency === "ALL") {
    return [...rates];
  }
  return rates.filter((rate) => rate.Agency === agency);
}

export function filterLinesByAgency(lines: readonly AssessmentLine[], agency: Agency | "ALL"): AssessmentLine[] {
  if (agency === "ALL") {
    return [...lines];
  }
  return lines.filter((line) => line.agency === agency);
}

/** Per-agency rate-registry summary for the overview cards. */
export interface AgencyRateSummary {
  agency: Agency;
  rateCount: number;
  activeCount: number;
  provisionalCount: number;
  instruments: string[];
}

// summarizeRatesByAgency groups the observed rate registry by its data
// agency dimension. Agencies with no observed rate rows are absent from the
// result — the overview renders those as honest no-data cards, never zeros.
export function summarizeRatesByAgency(rates: readonly TariffRateRow[]): AgencyRateSummary[] {
  const summaries: AgencyRateSummary[] = [];
  for (const agency of AGENCIES) {
    const rows = rates.filter((rate) => rate.Agency === agency);
    if (rows.length === 0) {
      continue;
    }
    summaries.push({
      agency,
      rateCount: rows.length,
      activeCount: rows.filter((rate) => rate.State === "ACTIVE").length,
      provisionalCount: rows.filter((rate) => rate.Provisional).length,
      instruments: [...new Set(rows.map((rate) => rate.Instrument))].sort(),
    });
  }
  return summaries;
}

/** Agencies (from the fixed ministry list) with NO observed rows in a data
 * set — these render the honest "no data" card variant. */
export function agenciesWithoutRates(rates: readonly TariffRateRow[]): Agency[] {
  const present = new Set(rates.map((rate) => rate.Agency));
  return AGENCIES.filter((agency) => !present.has(agency));
}

/* -------------------------------------------------------------------------
 * Subsidy aggregation: per-route BlueFare transparency totals.
 * ------------------------------------------------------------------------- */

export interface SubsidyTotals {
  rides: number;
  standardFareNgnMinor: number;
  chargedNgnMinor: number;
  subsidyNgnMinor: number;
}

export function sumSubsidyLines(lines: readonly SubsidyLine[]): SubsidyTotals {
  return lines.reduce<SubsidyTotals>(
    (totals, line) => ({
      rides: totals.rides + line.rides,
      standardFareNgnMinor: totals.standardFareNgnMinor + line.standardFareNgnMinor,
      chargedNgnMinor: totals.chargedNgnMinor + line.chargedNgnMinor,
      subsidyNgnMinor: totals.subsidyNgnMinor + line.subsidyNgnMinor,
    }),
    { rides: 0, standardFareNgnMinor: 0, chargedNgnMinor: 0, subsidyNgnMinor: 0 },
  );
}

/** One point of the monthly subsidy time series. A bucket whose upstream
 * call failed is `failed` — rendered as an explicit gap, never a zero. */
export type SubsidySeriesPoint =
  | { kind: "ok"; bucket: MonthBucket; totals: SubsidyTotals }
  | { kind: "failed"; bucket: MonthBucket; detail: string };

/** subsidySharePercent: forgone fare as a percentage of the standard fare;
 * null when there were no capped journeys (division by zero would fabricate
 * a figure). */
export function subsidySharePercent(totals: SubsidyTotals): number | null {
  if (totals.standardFareNgnMinor <= 0) {
    return null;
  }
  return (totals.subsidyNgnMinor / totals.standardFareNgnMinor) * 100;
}

/* -------------------------------------------------------------------------
 * Empty-state honesty: every dashboard panel resolves to exactly one state
 * and the state distinguishes endpoint-down from no-data.
 * ------------------------------------------------------------------------- */

export type PanelState =
  | { kind: "loading" }
  | { kind: "endpoint-down"; detail: string; retryable: boolean }
  | { kind: "unauthorized"; detail: string }
  | { kind: "forbidden"; detail: string }
  | { kind: "no-data"; detail: string }
  | { kind: "integration-gap"; detail: string }
  | { kind: "ready" };

// RevenuePanelError is the classifiable subset of panel states (everything
// except loading/ready/integration-gap). The classifier lives in
// revenue-client.ts next to the RevenueApiError definition.
export type RevenuePanelError = Exclude<PanelState, { kind: "loading" | "ready" | "integration-gap" }>;
