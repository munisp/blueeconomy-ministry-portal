// Typed API clients for the revenue dashboards (W-FEAT-9). Each client maps
// to exactly one upstream service and wires ONLY to endpoints verified
// against the service ODBs:
//   - ferry-ticketing @ df6c147: GET /v1/reports/subsidy,
//     GET /v1/reports/settlement (BlueFare transparency/settlement reports).
//   - financial-controls @ 3bff518: GET /v1/tariffs/rates,
//     GET /v1/tariffs/assessments/{id},
//     GET /v1/tariffs/assessments/{id}/exemption-audits.
//   - port-interoperability @ df9ed45: GET /v1/bookings/{id} (payment receipt
//     and refund state on the booking record).
//
// All calls go through the global fetch so the portal's RUM fetch
// instrumentation (src/telemetry.ts) traces them — no parallel telemetry
// path. Every failure is a RevenueApiError with an explicit taxonomy so the
// UI can distinguish endpoint-down from no-data; no call ever substitutes
// fabricated data.

import type { RevenueRuntimeConfiguration } from "../runtime-config";
import type {
  Assessment,
  BookingRecord,
  ExemptionAuditList,
  Provenance,
  RevenuePanelError,
  RevenueServiceId,
  SettlementAggregate,
  SubsidyReport,
  TariffRateList,
} from "./revenue-model";
import {
  assessmentProvenance,
  bookingReceiptProvenance,
  exemptionAuditsProvenance,
  settlementReportProvenance,
  subsidyReportProvenance,
  tariffRatesProvenance,
} from "./revenue-model";

// RevenueErrorKind is the failure taxonomy the dashboards render:
//   - "network":  the endpoint could not be reached at all (endpoint-down).
//   - "http":     the endpoint answered with a non-2xx status; status 404 is
//                 further surfaced via notFound() as the no-data state.
//   - "contract": the endpoint answered 2xx but the body does not match the
//                 recorded upstream shape (endpoint drift, treated as down).
export type RevenueErrorKind = "network" | "http" | "contract";

export class RevenueApiError extends Error {
  readonly kind: RevenueErrorKind;
  readonly status: number | null;
  readonly service: RevenueServiceId;
  readonly provenance: Provenance;

  constructor(kind: RevenueErrorKind, status: number | null, service: RevenueServiceId, provenance: Provenance, message: string) {
    super(message);
    this.name = "RevenueApiError";
    this.kind = kind;
    this.status = status;
    this.service = service;
    this.provenance = provenance;
  }

  /** notFound marks the "endpoint up, record absent" case — the dashboards
   * render it as no-data, never as an outage. */
  notFound(): boolean {
    return this.kind === "http" && this.status === 404;
  }
}

// classifyRevenueError maps an observed failure onto the honest panel
// states. The endpoint-down vs no-data distinction is binding:
//   - 404 from a record lookup          -> no-data (the endpoint answered;
//                                          the record is absent).
//   - network failure / 5xx / contract  -> endpoint-down (retryable).
//   - 401                               -> unauthorized (re-authenticate).
//   - 403                               -> forbidden (role/tenancy boundary).
// Anything unrecognised is endpoint-down retryable — the dashboards never
// render an unclassified failure as an empty data set.
export function classifyRevenueError(error: unknown): RevenuePanelError {
  if (error instanceof RevenueApiError) {
    if (error.status === 401) {
      return { kind: "unauthorized", detail: error.message };
    }
    if (error.status === 403) {
      return { kind: "forbidden", detail: error.message };
    }
    if (error.notFound()) {
      return { kind: "no-data", detail: error.message };
    }
    return { kind: "endpoint-down", detail: error.message, retryable: true };
  }
  return {
    kind: "endpoint-down",
    detail: error instanceof Error ? error.message : "the call failed without a diagnostic",
    retryable: true,
  };
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function readErrorEnvelope(response: Response): Promise<string | null> {
  try {
    const candidate: unknown = await response.json();
    if (typeof candidate === "object" && candidate !== null && "error" in candidate && typeof candidate.error === "string" && candidate.error.length > 0) {
      return candidate.error;
    }
  } catch {
    // A non-JSON error body carries no usable detail; the status stands alone.
  }
  return null;
}

async function revenueGet(token: string, provenance: Provenance, base: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(base)}${provenance.path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (error) {
    throw new RevenueApiError("network", null, provenance.service, provenance, `${provenance.service} could not be reached (${error instanceof Error ? error.message : "network failure"})`);
  }
  if (!response.ok) {
    const detail = await readErrorEnvelope(response);
    const suffix = detail === null ? "" : `: ${detail}`;
    throw new RevenueApiError("http", response.status, provenance.service, provenance, `${provenance.service} returned HTTP ${response.status}${suffix}`);
  }
  try {
    return await response.json();
  } catch {
    throw new RevenueApiError("contract", response.status, provenance.service, provenance, `${provenance.service} returned a non-JSON response`);
  }
}

/* -------------------------------------------------------------------------
 * Recorded-shape validators. Each mirrors the upstream DTO field-for-field;
 * a drifted response is a contract failure, never partially trusted.
 * ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSettlementAggregate(value: unknown): value is SettlementAggregate {
  return isRecord(value) &&
    isText(value.operatorId) && isText(value.periodStart) && isText(value.periodEnd) &&
    isNumber(value.rides) && isNumber(value.grossNgnMinor) && isNumber(value.subsidyNgnMinor) &&
    isNumber(value.operatorShareBps) && isNumber(value.operatorShareNgnMinor) && isNumber(value.platformShareNgnMinor);
}

function isSubsidyLine(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.routeReference === "string" &&
    isNumber(value.rides) && isNumber(value.standardFareNgnMinor) &&
    isNumber(value.chargedNgnMinor) && isNumber(value.subsidyNgnMinor);
}

function isSubsidyReport(value: unknown): value is SubsidyReport {
  return isRecord(value) && Array.isArray(value.routes) && value.routes.every(isSubsidyLine);
}

function isTariffRateRow(value: unknown): value is TariffRateList["rates"][number] {
  return isRecord(value) &&
    isText(value.RateID) && isText(value.Instrument) && isText(value.Agency) &&
    typeof value.BandLogic === "string" && typeof value.Currency === "string" &&
    isNumber(value.RateMinorPerUnit) && isNumber(value.RateBps) && isNumber(value.BandFloor) &&
    (value.BandCeiling === null || isNumber(value.BandCeiling)) &&
    typeof value.StatutoryReference === "string" && typeof value.Provisional === "boolean" &&
    isText(value.EffectiveFrom) && (value.EffectiveTo === null || typeof value.EffectiveTo === "string") &&
    isText(value.State) && typeof value.Maker === "string" && typeof value.Checker === "string";
}

function isTariffRateList(value: unknown): value is TariffRateList {
  return isRecord(value) && Array.isArray(value.rates) && value.rates.every(isTariffRateRow);
}

function isAssessmentLine(value: unknown): value is Assessment["lines"][number] {
  return isRecord(value) &&
    isNumber(value.lineNo) && isText(value.instrument) && isText(value.agency) &&
    isText(value.applicability) && typeof value.basis === "string" &&
    isNumber(value.amountMinor) && isText(value.currency);
}

function isAssessment(value: unknown): value is Assessment {
  return isRecord(value) &&
    isText(value.assessmentId) && isText(value.asOf) &&
    Array.isArray(value.lines) && value.lines.every(isAssessmentLine) &&
    isNumber(value.totalUsdMinor) && isNumber(value.totalNgnMinor) &&
    typeof value.requester === "string" && typeof value.correlationId === "string" && isText(value.createdAt);
}

function isExemptionAudit(value: unknown): value is ExemptionAuditList["audits"][number] {
  return isRecord(value) &&
    isText(value.AuditID) && isText(value.AssessmentID) && isText(value.ExemptionID) &&
    isText(value.Instrument) && isText(value.MatchKind) && typeof value.MatchValue === "string" &&
    isText(value.StatutoryBasis) && typeof value.EvidenceRequirement === "string" &&
    typeof value.Requester === "string" && isText(value.CreatedAt);
}

function isExemptionAuditList(value: unknown): value is ExemptionAuditList {
  return isRecord(value) && Array.isArray(value.audits) && value.audits.every(isExemptionAudit);
}

function isBookingRecord(value: unknown): value is BookingRecord {
  return isRecord(value) &&
    isText(value.booking_id) && isText(value.tenant_id) && isText(value.request_id) &&
    isText(value.terminal_id) && typeof value.channel === "string" && isText(value.status) &&
    isNumber(value.amount_kobo) && isText(value.currency) &&
    (value.payment_receipt_ref === undefined || typeof value.payment_receipt_ref === "string") &&
    (value.ledger_commit_hash === undefined || typeof value.ledger_commit_hash === "string") &&
    isText(value.created_at) && isText(value.updated_at) && isText(value.expires_at) && isNumber(value.version);
}

function contractError(service: RevenueServiceId, provenance: Provenance, what: string): RevenueApiError {
  return new RevenueApiError("contract", 200, service, provenance, `${service} returned an unexpected ${what} shape`);
}

/* -------------------------------------------------------------------------
 * ferry-ticketing (BlueFare) report reads.
 * ------------------------------------------------------------------------- */

/** fetchSubsidyReport reads GET /v1/reports/subsidy for [from, toExclusive). */
export async function fetchSubsidyReport(
  configuration: RevenueRuntimeConfiguration,
  token: string,
  from: string,
  toExclusive: string,
): Promise<SubsidyReport> {
  const provenance = subsidyReportProvenance(from, toExclusive);
  const candidate = await revenueGet(token, provenance, configuration.ferry_api_url);
  if (!isSubsidyReport(candidate)) {
    throw contractError("ferry-ticketing", provenance, "subsidy report");
  }
  return candidate;
}

/** fetchSettlementReport reads GET /v1/reports/settlement for one operator
 * and period. A 404 surfaces as no-data (the operator has no settlement rule
 * or no recorded period), distinct from an outage. */
export async function fetchSettlementReport(
  configuration: RevenueRuntimeConfiguration,
  token: string,
  operatorId: string,
  from: string,
  toExclusive: string,
): Promise<SettlementAggregate> {
  const provenance = settlementReportProvenance(operatorId, from, toExclusive);
  const candidate = await revenueGet(token, provenance, configuration.ferry_api_url);
  if (!isSettlementAggregate(candidate)) {
    throw contractError("ferry-ticketing", provenance, "settlement report");
  }
  return candidate;
}

/* -------------------------------------------------------------------------
 * financial-controls tariff engine reads.
 * ------------------------------------------------------------------------- */

/** fetchTariffRates reads the full versioned rate registry (GET
 * /v1/tariffs/rates). An empty registry is a valid no-data result. */
export async function fetchTariffRates(
  configuration: RevenueRuntimeConfiguration,
  token: string,
): Promise<TariffRateList> {
  const provenance = tariffRatesProvenance();
  const candidate = await revenueGet(token, provenance, configuration.tariff_api_url);
  if (!isTariffRateList(candidate)) {
    throw contractError("financial-controls", provenance, "rate registry");
  }
  return candidate;
}

/** fetchAssessment reads one immutable assessment by id. 404 = no-data. */
export async function fetchAssessment(
  configuration: RevenueRuntimeConfiguration,
  token: string,
  assessmentId: string,
): Promise<Assessment> {
  const provenance = assessmentProvenance(assessmentId);
  const candidate = await revenueGet(token, provenance, configuration.tariff_api_url);
  if (!isAssessment(candidate)) {
    throw contractError("financial-controls", provenance, "assessment");
  }
  return candidate;
}

/** fetchExemptionAudits reads the applied-exemption audit trail of one
 * assessment (NLNG lesson: exemptions are first-class and auditable). */
export async function fetchExemptionAudits(
  configuration: RevenueRuntimeConfiguration,
  token: string,
  assessmentId: string,
): Promise<ExemptionAuditList> {
  const provenance = exemptionAuditsProvenance(assessmentId);
  const candidate = await revenueGet(token, provenance, configuration.tariff_api_url);
  if (!isExemptionAuditList(candidate)) {
    throw contractError("financial-controls", provenance, "exemption audit list");
  }
  return candidate;
}

/* -------------------------------------------------------------------------
 * port-interoperability booking payment receipt read.
 * ------------------------------------------------------------------------- */

/** fetchBookingReceipt reads one booking record (GET /v1/bookings/{id}),
 * carrying the payment receipt reference, amount and refund state. 404 =
 * no-data; 403 = the record is not visible to this tenancy/role. */
export async function fetchBookingReceipt(
  configuration: RevenueRuntimeConfiguration,
  token: string,
  bookingId: string,
): Promise<BookingRecord> {
  const provenance = bookingReceiptProvenance(bookingId);
  const candidate = await revenueGet(token, provenance, configuration.port_interop_api_url);
  if (!isBookingRecord(candidate)) {
    throw contractError("port-interoperability", provenance, "booking record");
  }
  return candidate;
}
