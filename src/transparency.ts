import { fetchPortPerformanceReport, type PortPerformancePeriod, type PortPerformanceReport } from "./kpi-client";
import { apiGetSignedBlob } from "./api-client";

/**
 * Transparency dashboard data layer (#13): a read-only aggregated view over
 * the real port-performance report, plus signed-data provenance extracted
 * from the backend's JWS envelope. Nothing is aggregated client-side beyond
 * summing the backend's own reported figures; unsigned payloads are labelled
 * as such, never implied to be signed.
 */

export interface TransparencyTotals {
  period: PortPerformancePeriod;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  cargoThroughputTonnes: number | null;
  teuTotal: number | null;
  transshipmentTeu: number | null;
  vesselCalls: number | null;
  sources: string[];
}

export interface SignatureProvenance {
  /** Compact JWS carried by the signed export envelope. */
  signature: string;
  algorithm: string | null;
  /** JWS header `kid` when the signer declared one. */
  keyId: string | null;
}

export interface TransparencyView {
  totals: TransparencyTotals;
  provenance: SignatureProvenance | null;
}

/** Sum helper: null when every contributing metric has no data. */
function sumNullable(values: (number | null)[]): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value !== null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

export function aggregateTransparencyTotals(report: PortPerformanceReport): TransparencyTotals {
  const metrics = report.metrics;
  return {
    period: report.period,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    generatedAt: report.generated_at,
    cargoThroughputTonnes: metrics.cargo_throughput_tonnes.value,
    teuTotal: sumNullable([metrics.teu_in.value, metrics.teu_out.value]),
    transshipmentTeu: metrics.transshipment_volume_teu.value,
    vesselCalls: metrics.vessel_calls.value,
    sources: [
      metrics.cargo_throughput_tonnes.source,
      metrics.teu_in.source,
      metrics.transshipment_volume_teu.source,
      metrics.vessel_calls.source,
    ],
  };
}

/**
 * Extract the JWS header (`alg`, `kid`) from a compact JWS without verifying
 * it — verification is anchored at the backend signing key; the portal only
 * surfaces provenance metadata. Returns null when the compact serialization
 * is malformed or the header is not JSON.
 */
export function jwsHeaderInfo(compactJws: string): { algorithm: string | null; keyId: string | null } | null {
  const parts = compactJws.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const headerText = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
    const header: unknown = JSON.parse(headerText);
    if (typeof header !== "object" || header === null) {
      return null;
    }
    const record = header as Record<string, unknown>;
    return {
      algorithm: typeof record.alg === "string" ? record.alg : null,
      keyId: typeof record.kid === "string" ? record.kid : null,
    };
  } catch {
    return null;
  }
}

/**
 * Load the transparency view: quarterly aggregated totals from the real
 * port-performance report, plus signature provenance from the signed PDF
 * export envelope when the backend offers one. The PDF bytes themselves are
 * discarded here — this view needs only the provenance, not the document.
 * Fail-closed: report/validation errors propagate; an unavailable or
 * unsigned export simply yields `provenance: null` with the UI labelling
 * the payload unsigned.
 */
export async function fetchTransparencyView(baseUrl: string, token: string, period: PortPerformancePeriod = "quarterly"): Promise<TransparencyView> {
  const report = await fetchPortPerformanceReport(baseUrl, token, period);
  let provenance: SignatureProvenance | null = null;
  try {
    const signed = await apiGetSignedBlob(baseUrl, `/v1/port-performance/report.pdf?period=${period}`, token);
    if (signed.signature !== null) {
      const header = jwsHeaderInfo(signed.signature);
      provenance = {
        signature: signed.signature,
        algorithm: signed.signatureAlgorithm ?? header?.algorithm ?? null,
        keyId: header?.keyId ?? null,
      };
    }
  } catch {
    // The export endpoint may be absent (404) on this deployment. The JSON
    // report remains authoritative; provenance is honestly reported absent.
    provenance = null;
  }
  return { totals: aggregateTransparencyTotals(report), provenance };
}
