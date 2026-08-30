// Revenue overview dashboard (W-FEAT-9): per-agency cards and a monthly
// time series built ONLY from endpoints that exist upstream:
//   - agency cards summarise the tariff rate registry (financial-controls
//     GET /v1/tariffs/rates) grouped by the data-carried Agency field;
//   - the time series queries the BlueFare subsidy report (ferry-ticketing
//     GET /v1/reports/subsidy) once per calendar-month bucket — every point
//     is a real authorised call, and a failed bucket renders as a gap.
//
// Honesty rules: agencies with no data-producing endpoint (CBN) render a
// no-data card, never zeros; the W-FEAT-6/7 read surfaces are declared as
// integration gaps, not drawn.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RevenueRuntimeConfiguration } from "../runtime-config";
import { classifyRevenueError, fetchSubsidyReport, fetchTariffRates } from "./revenue-client";
import type { RevenuePanelError, SubsidySeriesPoint, TariffRateRow } from "./revenue-model";
import {
  agenciesWithoutRates,
  monthBuckets,
  resolveDateRange,
  subsidySharePercent,
  summarizeRatesByAgency,
  sumSubsidyLines,
  tariffRatesProvenance,
  type AgencyRateSummary,
} from "./revenue-model";
import { AgencyFilterSelect, DateRangeControls, defaultRange, formatMinor, PanelStateView, ProvenanceNote, type AgencyFilter } from "./revenue-ui";

interface Properties {
  configuration: RevenueRuntimeConfiguration;
  token: string;
  onUnauthorized: () => void;
}

type RatesState =
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; rates: TariffRateRow[]; observedAt: string };

type SeriesState =
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; points: SubsidySeriesPoint[] };

// INTEGRATION_GAPS are the read surfaces the brief requires but that have no
// upstream endpoint yet. They are declared, never drawn.
export const INTEGRATION_GAPS: readonly string[] = [
  "W-FEAT-6 cruise/offshore revenue endpoints are still in flight — no cruise or offshore revenue figures exist upstream, so none are shown.",
  "W-FEAT-7 debit-note, TSA and reconciliation endpoints are still in flight — no debit-note or TSA balances exist upstream, so none are shown.",
  "CBN holds observer roles only; no upstream endpoint produces CBN-attributed revenue, so the CBN card cannot carry figures.",
];

export function RevenueOverviewPage({ configuration, token, onUnauthorized }: Properties) {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [toInclusive, setTo] = useState(initial.toInclusive);
  const [agency, setAgency] = useState<AgencyFilter>("ALL");
  const [ratesState, setRatesState] = useState<RatesState>({ kind: "loading" });
  const [seriesState, setSeriesState] = useState<SeriesState>({ kind: "loading" });

  const range = useMemo(() => resolveDateRange(from, toInclusive), [from, toInclusive]);

  const loadRates = useCallback(async () => {
    setRatesState({ kind: "loading" });
    try {
      const result = await fetchTariffRates(configuration, token);
      setRatesState({ kind: "ready", rates: result.rates, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setRatesState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }, [configuration, token, onUnauthorized]);

  const loadSeries = useCallback(async () => {
    if (typeof range === "string") {
      return;
    }
    setSeriesState({ kind: "loading" });
    const buckets = monthBuckets(range);
    const points: SubsidySeriesPoint[] = [];
    let unauthorized = false;
    // Sequential by design: the series is a bounded set of authorised calls
    // and a failure in one bucket must not fail the others — it is recorded
    // as a gap point instead.
    for (const bucket of buckets) {
      try {
        const report = await fetchSubsidyReport(configuration, token, bucket.from, bucket.toExclusive);
        points.push({ kind: "ok", bucket, totals: sumSubsidyLines(report.routes) });
      } catch (error) {
        const classified = classifyRevenueError(error);
        if (classified.kind === "unauthorized") {
          unauthorized = true;
        }
        points.push({ kind: "failed", bucket, detail: classified.detail });
      }
    }
    setSeriesState({ kind: "ready", points });
    if (unauthorized) {
      onUnauthorized();
    }
  }, [configuration, token, range, onUnauthorized]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  function changeRange(nextFrom: string, nextTo: string): void {
    setFrom(nextFrom);
    setTo(nextTo);
  }

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Revenue dashboards</p>
          <h2>Revenue overview</h2>
        </div>
        <p className="section-note">Agency dimension comes from upstream data fields. Figures appear only where an authorised endpoint produced them.</p>
      </div>

      <div className="queue-controls revenue-controls">
        <AgencyFilterSelect value={agency} onChange={setAgency} />
        <button className="button button--quiet" onClick={() => { void loadRates(); void loadSeries(); }}>Refresh</button>
      </div>
      <DateRangeControls from={from} toInclusive={toInclusive} onChange={changeRange} />
      {typeof range === "string" && (
        <p className="validation-errors" role="alert">Date range invalid: {range}. The dashboards do not issue a query until the range is valid.</p>
      )}

      <IntegrationGapBanner />

      <h3 className="revenue-subheading">Agency revenue lines</h3>
      {ratesState.kind !== "ready" && <PanelStateView state={ratesState.kind === "loading" ? { kind: "loading" } : ratesState.error} onRetry={() => void loadRates()} />}
      {ratesState.kind === "ready" && (
        <AgencyCards rates={ratesState.rates} agency={agency} observedAt={ratesState.observedAt} />
      )}

      <h3 className="revenue-subheading">BlueFare forgone-fare series (monthly)</h3>
      {agency !== "ALL" && (
        <p className="queue-note" role="status">The BlueFare subsidy report carries route and operator dimensions, not an agency field — this series is not agency-filtered. No agency is attributed to it.</p>
      )}
      {seriesState.kind !== "ready" && <PanelStateView state={seriesState.kind === "loading" ? { kind: "loading" } : seriesState.error} onRetry={() => void loadSeries()} />}
      {seriesState.kind === "ready" && <SubsidySeries points={seriesState.points} />}
    </section>
  );
}

export function IntegrationGapBanner() {
  return (
    <section className="assurance-banner assurance-banner--restricted revenue-gap-banner" aria-label="Declared integration gaps">
      <span className="assurance-mark">Integration gaps</span>
      <div>
        {INTEGRATION_GAPS.map((gap) => <p key={gap}>{gap}</p>)}
      </div>
    </section>
  );
}

function AgencyCards({ rates, agency, observedAt }: { rates: TariffRateRow[]; agency: AgencyFilter; observedAt: string }) {
  const summaries = summarizeRatesByAgency(rates);
  const missing = agenciesWithoutRates(rates);
  const visibleSummaries = agency === "ALL" ? summaries : summaries.filter((summary) => summary.agency === agency);
  const visibleMissing = agency === "ALL" ? missing : missing.filter((candidate) => candidate === agency);
  if (rates.length === 0) {
    return (
      <>
        <PanelStateView state={{ kind: "no-data", detail: "The tariff engine returned an empty rate registry." }} />
        <ProvenanceNote provenance={tariffRatesProvenance()} observedAt={observedAt} />
      </>
    );
  }
  return (
    <>
      <div className="service-grid revenue-card-grid">
        {visibleSummaries.map((summary) => <AgencyCard key={summary.agency} summary={summary} />)}
        {visibleMissing.map((candidate) => (
          <article className="service-tile revenue-card revenue-card--empty" key={candidate}>
            <div className="service-tile__header">
              <p className="service-id">{candidate}</p>
              <span className="probe-status probe-status--neutral">No data</span>
            </div>
            <h3>{candidate}</h3>
            <p className="revenue-card__note">No rate-registry rows carry this agency code in the observed data. No figures are shown for {candidate} — an absent record is not a zero.</p>
          </article>
        ))}
      </div>
      {visibleSummaries.length === 0 && visibleMissing.length === 0 && (
        <p className="queue-note" role="status">No agency cards match the current filter over the observed registry.</p>
      )}
      <ProvenanceNote provenance={tariffRatesProvenance()} observedAt={observedAt} />
      <p className="queue-note">Agency cards summarise the versioned statutory rate registry (the revenue lines each agency charges). Per-voyage assessed amounts are per-record: open the assessment view for a recorded assessment id.</p>
    </>
  );
}

function AgencyCard({ summary }: { summary: AgencyRateSummary }) {
  return (
    <article className="service-tile revenue-card">
      <div className="service-tile__header">
        <p className="service-id">{summary.agency}</p>
        <span className="probe-status probe-status--success">{summary.activeCount} active rate{summary.activeCount === 1 ? "" : "s"}</span>
      </div>
      <h3>{summary.agency} revenue lines</h3>
      <dl className="vessel-detail">
        <div><dt>Registry rows</dt><dd>{summary.rateCount}</dd></div>
        <div><dt>Provisional</dt><dd>{summary.provisionalCount}</dd></div>
        <div><dt>Instruments</dt><dd>{summary.instruments.join(", ")}</dd></div>
      </dl>
    </article>
  );
}

function SubsidySeries({ points }: { points: SubsidySeriesPoint[] }) {
  const okPoints = points.filter((point): point is Extract<SubsidySeriesPoint, { kind: "ok" }> => point.kind === "ok");
  const failed = points.filter((point): point is Extract<SubsidySeriesPoint, { kind: "failed" }> => point.kind === "failed");
  if (okPoints.length === 0 && failed.length > 0) {
    return <PanelStateView state={{ kind: "endpoint-down", detail: `Every monthly bucket failed: ${failed[0].detail}`, retryable: true }} />;
  }
  const maximum = Math.max(1, ...okPoints.map((point) => point.totals.standardFareNgnMinor));
  const allEmpty = okPoints.every((point) => point.totals.rides === 0);
  return (
    <>
      {allEmpty && failed.length === 0 && (
        <p className="queue-note" role="status">Every month in the range returned zero capped journeys — an observed no-data series, drawn honestly as empty bars.</p>
      )}
      <div className="series-chart" role="img" aria-label="Monthly BlueFare standard fare versus charged fare">
        {points.map((point) => (
          <div className="series-chart__column" key={point.bucket.label}>
            {point.kind === "ok" ? (
              <>
                <span
                  className="series-chart__bar series-chart__bar--standard"
                  style={{ height: `${Math.max(point.totals.standardFareNgnMinor > 0 ? 2 : 0, (point.totals.standardFareNgnMinor / maximum) * 100)}%` }}
                  title={`Standard fare ${formatMinor(point.totals.standardFareNgnMinor, "NGN")}`}
                />
                <span
                  className="series-chart__bar series-chart__bar--charged"
                  style={{ height: `${Math.max(point.totals.chargedNgnMinor > 0 ? 2 : 0, (point.totals.chargedNgnMinor / maximum) * 100)}%` }}
                  title={`Charged ${formatMinor(point.totals.chargedNgnMinor, "NGN")}`}
                />
              </>
            ) : (
              <span className="series-chart__gap" title={`Bucket unavailable: ${point.detail}`}>gap</span>
            )}
            <span className="series-chart__label">{point.bucket.label}</span>
          </div>
        ))}
      </div>
      <div className="tracking-map__legend">
        <span><span className="legend-dot legend-dot--standard" /> Standard fare (NGN)</span>
        <span><span className="legend-dot legend-dot--charged" /> Charged after caps/concessions (NGN)</span>
        <span><span className="legend-dot legend-dot--hollow" /> Gap = bucket call failed (not zero)</span>
      </div>
      <SeriesTable points={okPoints} />
      {failed.length > 0 && (
        <p className="queue-note" role="status">{failed.length} month bucket(s) could not be read ({failed.map((point) => point.bucket.label).join(", ")}); they are gaps in the series, not zeros.</p>
      )}
    </>
  );
}

function SeriesTable({ points }: { points: Extract<SubsidySeriesPoint, { kind: "ok" }>[] }) {
  return (
    <table className="queue-table revenue-table">
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Capped journeys</th>
          <th scope="col">Standard fare</th>
          <th scope="col">Charged</th>
          <th scope="col">Forgone (subsidy)</th>
          <th scope="col">Forgone share</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => {
          const share = subsidySharePercent(point.totals);
          return (
            <tr key={point.bucket.label}>
              <td>{point.bucket.label}</td>
              <td>{point.totals.rides.toLocaleString("en-NG")}</td>
              <td>{formatMinor(point.totals.standardFareNgnMinor, "NGN")}</td>
              <td>{formatMinor(point.totals.chargedNgnMinor, "NGN")}</td>
              <td>{formatMinor(point.totals.subsidyNgnMinor, "NGN")}</td>
              <td>{share === null ? "n/a (no capped journeys)" : `${share.toFixed(1)}%`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
