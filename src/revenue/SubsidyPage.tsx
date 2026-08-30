// BlueFare subsidy transparency view (W-FEAT-9 scope item 2): per-route
// subsidy paid and the capped-vs-uncapped fare distribution, from the one
// subsidy read surface that exists upstream — ferry-ticketing
// GET /v1/reports/subsidy (internal/httpapi/fare_handlers.go @ df6c147).
//
// Honest limits, declared in-page: the upstream report groups capped
// journeys by route only. It does not expose a per-operator subsidy split,
// a pass-vs-pay-go ride mix, or a journey-level record list; those render
// as integration-gap notes, never as estimated figures.

import { useCallback, useEffect, useState } from "react";
import type { RevenueRuntimeConfiguration } from "../runtime-config";
import { classifyRevenueError, fetchSubsidyReport } from "./revenue-client";
import type { DateRange, RevenuePanelError, SubsidyLine } from "./revenue-model";
import { resolveDateRange, subsidyReportProvenance, subsidySharePercent, sumSubsidyLines } from "./revenue-model";
import { BarPair, DateRangeControls, defaultRange, formatMinor, PanelStateView, ProvenanceNote, RangeSummary } from "./revenue-ui";

interface Properties {
  configuration: RevenueRuntimeConfiguration;
  token: string;
  onUnauthorized: () => void;
}

type SubsidyState =
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; lines: SubsidyLine[]; range: DateRange; observedAt: string };

export function SubsidyPage({ configuration, token, onUnauthorized }: Properties) {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [toInclusive, setTo] = useState(initial.toInclusive);
  const [state, setState] = useState<SubsidyState>({ kind: "loading" });

  const range = resolveDateRange(from, toInclusive);

  const load = useCallback(async () => {
    if (typeof range === "string") {
      return;
    }
    setState({ kind: "loading" });
    try {
      const report = await fetchSubsidyReport(configuration, token, range.from, range.toExclusive);
      setState({ kind: "ready", lines: report.routes, range, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }, [configuration, token, range, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BlueFare transparency</p>
          <h2>Subsidy by route</h2>
        </div>
        <p className="section-note">Forgone fare from caps, concessions and transfer discounts, aggregated per route by the ferry-ticketing report endpoint.</p>
      </div>

      <DateRangeControls from={from} toInclusive={toInclusive} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
      <div className="queue-controls revenue-controls">
        {typeof range !== "string" && <RangeSummary range={range} />}
        <button className="button button--quiet" onClick={() => void load()}>Refresh</button>
      </div>
      {typeof range === "string" && (
        <p className="validation-errors" role="alert">Date range invalid: {range}. No query is issued until the range is valid.</p>
      )}

      {state.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
      {state.kind === "error" && <PanelStateView state={state.error} onRetry={() => void load()} />}
      {state.kind === "ready" && <SubsidyReady lines={state.lines} range={state.range} observedAt={state.observedAt} />}

      <section className="assurance-banner revenue-gap-banner" aria-label="Declared limits of this view">
        <span className="assurance-mark">Declared limits</span>
        <div>
          <p>Per-operator subsidy splits are not exposed by the subsidy report (it groups by route); use the settlement view for per-operator totals.</p>
          <p>The pass-vs-pay-go ride mix is not exposed by any BlueFare report endpoint — the settlement aggregate counts pass rides only inside its total. No mix ratio is shown because none exists upstream.</p>
          <p>Journey-level records behind each route row are not exposed by a list endpoint; the route row is the most granular published record and names its source call.</p>
        </div>
      </section>
    </section>
  );
}

function SubsidyReady({ lines, range, observedAt }: { lines: SubsidyLine[]; range: DateRange; observedAt: string }) {
  const provenance = subsidyReportProvenance(range.from, range.toExclusive);
  if (lines.length === 0) {
    return (
      <>
        <PanelStateView state={{ kind: "no-data", detail: "The subsidy report returned zero route rows for this window." }} />
        <ProvenanceNote provenance={provenance} observedAt={observedAt} />
      </>
    );
  }
  const totals = sumSubsidyLines(lines);
  const share = subsidySharePercent(totals);
  return (
    <>
      <div className="detail-grid revenue-totals">
        <dt>Capped journeys</dt><dd>{totals.rides.toLocaleString("en-NG")}</dd>
        <dt>Standard fare</dt><dd>{formatMinor(totals.standardFareNgnMinor, "NGN")}</dd>
        <dt>Charged after caps/concessions</dt><dd>{formatMinor(totals.chargedNgnMinor, "NGN")}</dd>
        <dt>Forgone fare (subsidy)</dt><dd>{formatMinor(totals.subsidyNgnMinor, "NGN")}{share === null ? "" : ` (${share.toFixed(1)}% of standard)`}</dd>
      </div>
      <table className="queue-table revenue-table">
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Capped journeys</th>
            <th scope="col">Standard vs charged (NGN)</th>
            <th scope="col">Subsidy</th>
            <th scope="col">Subsidy share</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const lineShare = subsidySharePercent(line);
            return (
              <tr key={line.routeReference === "" ? "(unattributed)" : line.routeReference}>
                <td>{line.routeReference === "" ? "(no route reference recorded)" : line.routeReference}</td>
                <td>{line.rides.toLocaleString("en-NG")}</td>
                <td className="revenue-bar-cell">
                  <BarPair
                    label={line.routeReference === "" ? "unattributed route" : line.routeReference}
                    primary={line.standardFareNgnMinor}
                    secondary={line.chargedNgnMinor}
                    primaryText={`standard ${formatMinor(line.standardFareNgnMinor, "NGN")}`}
                    secondaryText={`charged ${formatMinor(line.chargedNgnMinor, "NGN")}`}
                  />
                </td>
                <td>{formatMinor(line.subsidyNgnMinor, "NGN")}</td>
                <td>{lineShare === null ? "n/a" : `${lineShare.toFixed(1)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ProvenanceNote provenance={provenance} observedAt={observedAt} />
    </>
  );
}
