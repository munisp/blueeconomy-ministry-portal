// StatisticsPage is the #/statistics port & blue-economy statistics
// dashboard. Every figure is an exact precomputed gold row served by the
// data-platform statistics API (GET /v1/stats/kpis, /v1/stats/runs,
// /v1/stats/values): summary cards show the latest published rows per KPI,
// charts plot the served rows per port/period, and no-data rows render
// their recorded coverage note. The KPI registry is the authoritative list
// of published KPIs — emissions/MRV and blue-carbon figures are not part
// of the API's published surface, so the dashboard says so honestly instead
// of inventing them. API failures fail closed: no fallback data anywhere.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import type { StatisticsEndpoints } from "../endpoint-config";
import { ErrorNotice, LoadingNotice, classifyServiceError } from "../api-state";
import { StatsApiError, getKpiRegistry, listRuns, probeStatsHealth, queryValues } from "./stats-client";
import {
  formatKpiValue,
  segmentLabel,
  type KpiRegistry,
  type StatsRunManifest,
  type StatsValueRow,
} from "./stats-model";
import { EChart } from "./EChart";

export interface StatisticsPageProperties {
  endpoints: StatisticsEndpoints;
  token: string;
  onUnauthorized: () => void;
}

type DashboardState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | {
      kind: "loaded";
      healthy: boolean;
      registry: KpiRegistry;
      runs: StatsRunManifest[];
      values: StatsValueRow[];
      runsDropped: number;
      valuesDropped: number;
      fetchedAt: string;
    };

export function StatisticsPage({ endpoints, token, onUnauthorized }: StatisticsPageProperties) {
  const [state, setState] = useState<DashboardState>({ kind: "loading" });
  const [periodFilter, setPeriodFilter] = useState<string>("");
  const [portFilter, setPortFilter] = useState<string>("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [healthy, registry, runs] = await Promise.all([
        probeStatsHealth(endpoints),
        getKpiRegistry(endpoints, token),
        listRuns(endpoints, token),
      ]);
      const filters: { period?: string } = {};
      if (runs.runs.length > 0) {
        // Default view: the latest published computation period from the
        // provenance ledger (the API orders runs newest-first).
        filters.period = runs.runs[0].period;
      }
      const values = await queryValues(endpoints, token, filters);
      setState({
        kind: "loaded",
        healthy,
        registry,
        runs: runs.runs,
        values: values.values,
        runsDropped: runs.dropped,
        valuesDropped: values.dropped,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      setState({ kind: "error", error });
    }
  }, [endpoints, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadValues = useCallback(
    async (period: string, portCode: string) => {
      setState((current) => {
        if (current.kind !== "loaded") {
          return current;
        }
        void (async () => {
          try {
            const filters: { period?: string; port_code?: string } = {};
            if (period !== "") {
              filters.period = period;
            }
            if (portCode !== "") {
              filters.port_code = portCode;
            }
            const values = await queryValues(endpoints, token, filters);
            setState((latest) =>
              latest.kind === "loaded"
                ? { ...latest, values: values.values, valuesDropped: values.dropped, fetchedAt: new Date().toISOString() }
                : latest,
            );
          } catch (error) {
            setState({ kind: "error", error });
          }
        })();
        return current;
      });
    },
    [endpoints, token],
  );

  const knownPeriods = useMemo(() => {
    if (state.kind !== "loaded") {
      return [];
    }
    return [...new Set(state.runs.map((run) => run.period))].sort().reverse();
  }, [state]);

  const knownPorts = useMemo(() => {
    if (state.kind !== "loaded") {
      return [];
    }
    return [...new Set(state.values.map((row) => row.port_code).filter((port): port is string => port !== null))].sort();
  }, [state]);

  if (state.kind === "loading") {
    return <LoadingNotice label="Loading the statistics dashboard" />;
  }
  if (state.kind === "error") {
    const classified = classifyServiceError(state.error, StatsApiError, "statistics API");
    if (classified.unauthorized) {
      onUnauthorized();
      return null;
    }
    return <ErrorNotice error={classified} onRetry={() => void load()} />;
  }

  const latestRun = state.runs[0] ?? null;
  const droppedTotal = state.runsDropped + state.valuesDropped;
  const effectivePeriod = periodFilter !== "" ? periodFilter : latestRun?.period ?? "";
  const summaryRows = state.values.filter((row) => row.period === effectivePeriod && (portFilter === "" || row.port_code === portFilter));

  return (
    <section className="service-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Port &amp; blue-economy statistics</p>
          <h2>Precomputed gold KPIs{latestRun !== null ? ` · period ${latestRun.period}` : ""}</h2>
        </div>
        <p className="section-note">
          Exact precomputed rows from the statistics API at {new Date(state.fetchedAt).toLocaleTimeString()}; the API never computes aggregates at request time and this dashboard never substitutes figures. Service liveness: {state.healthy ? "observed healthy" : "not observed"}.
          {droppedTotal > 0 ? ` ${droppedTotal} served record${droppedTotal === 1 ? "" : "s"} failed contract validation and ${droppedTotal === 1 ? "was" : "were"} not rendered.` : ""}
        </p>
      </div>

      {!state.healthy && (
        <div className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Service degraded</p>
          <h2>The statistics API liveness probe did not succeed</h2>
          <p>Data routes may still answer; everything shown below was served by the API in this session. No cached substitute is available.</p>
        </div>
      )}

      <ProvenancePanel run={latestRun} runCount={state.runs.length} />

      <div className="filter-bar" role="group" aria-label="Statistics filters">
        <label>
          Period
          <select
            value={effectivePeriod}
            onChange={(event) => {
              setPeriodFilter(event.target.value);
              reloadValues(event.target.value, portFilter);
            }}
          >
            {knownPeriods.length === 0 && <option value="">No published period</option>}
            {knownPeriods.map((period) => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>
        </label>
        <label>
          Port (UN/LOCODE)
          <select
            value={portFilter}
            onChange={(event) => {
              setPortFilter(event.target.value);
              reloadValues(effectivePeriod, event.target.value);
            }}
          >
            <option value="">All served slices</option>
            {knownPorts.map((port) => (
              <option key={port} value={port}>{port}</option>
            ))}
          </select>
        </label>
        <button className="button button--outline filter-bar__refresh" onClick={() => void load()}>Refresh</button>
      </div>

      {state.runs.length === 0 ? (
        <div className="empty-state" aria-live="polite">
          <p className="eyebrow">Nothing published yet</p>
          <h2>No statistics run has been published</h2>
          <p>The provenance ledger is empty: no governed computation run has produced gold KPI rows for this deployment. The dashboard does not fabricate estimates.</p>
        </div>
      ) : (
        <>
          <KpiSummaryCards registry={state.registry} rows={summaryRows} />
          <KpiCharts registry={state.registry} rows={summaryRows} period={effectivePeriod} />
          <GapPanel registry={state.registry} />
        </>
      )}
    </section>
  );
}

function ProvenancePanel({ run, runCount }: { run: StatsRunManifest | null; runCount: number }) {
  if (run === null) {
    return null;
  }
  return (
    <article className="panel">
      <h3>Provenance (latest published run)</h3>
      <dl className="fact-list">
        <div><dt>Run</dt><dd>{run.run_id}</dd></div>
        <div><dt>Computed at</dt><dd>{new Date(run.computed_at).toLocaleString()}</dd></div>
        <div><dt>Period</dt><dd>{run.period} ({new Date(run.period_start).toLocaleDateString()} – {new Date(run.period_end).toLocaleDateString()})</dd></div>
        <div><dt>Scope</dt><dd>{run.scope}</dd></div>
        <div><dt>Source table versions</dt><dd>{Object.entries(run.source_table_versions).map(([table, version]) => `${table}@${version}`).join(", ") || "none recorded"}</dd></div>
        <div><dt>KPIs / rows</dt><dd>{run.kpi_count} KPIs · {run.rows_emitted} rows emitted · {run.rows_no_data} no-data rows</dd></div>
        <div><dt>Report digest</dt><dd>{run.report_sha256}</dd></div>
        <div><dt>Ledger depth</dt><dd>{runCount} published run{runCount === 1 ? "" : "s"}</dd></div>
      </dl>
    </article>
  );
}

// KpiSummaryCards renders one card per published KPI with its latest served
// rows. A KPI with only no-data rows shows the recorded coverage note; a
// KPI with no served rows at all says so. Nothing is estimated.
function KpiSummaryCards({ registry, rows }: { registry: KpiRegistry; rows: StatsValueRow[] }) {
  return (
    <div className="service-grid">
      {registry.kpis.map((kpi) => {
        const kpiRows = rows.filter((row) => row.kpi_id === kpi.kpi_id);
        const dataRows = kpiRows.filter((row) => row.value !== null);
        const headline = dataRows.find((row) => row.port_code === null && row.ship_class === null && row.percentile === null) ?? dataRows[0] ?? null;
        return (
          <article className="service-tile" key={kpi.kpi_id}>
            <div className="service-tile__header">
              <p className="service-id">{kpi.kpi_id}</p>
              <span className={`probe-status ${headline !== null ? "probe-status--success" : "probe-status--neutral"}`}>{headline !== null ? "Published" : "No published value"}</span>
            </div>
            <h3>{kpi.name}</h3>
            {headline !== null ? (
              <>
                <p className="kpi-headline">{formatKpiValue(headline)}</p>
                <p className="cell-sub">{segmentLabel(headline)} · n={headline.n_observations}</p>
              </>
            ) : (
              <p className="panel-note">
                {kpiRows.length > 0 && kpiRows[0].coverage_note !== null
                  ? kpiRows[0].coverage_note
                  : kpi.gap_id !== null
                    ? `Blocked by ${kpi.gap_id}: no value is published until the upstream feed exists.`
                    : "No row was served for this KPI under the current filters."}
              </p>
            )}
            <p className="cell-sub">{kpi.definition}</p>
          </article>
        );
      })}
    </div>
  );
}

// KpiCharts renders bar charts of the exact served rows: one chart per KPI
// with data, x-axis = served slice (port/segment), plus a period series for
// count-style KPIs when multiple slices exist. Values are the API's rows
// verbatim.
function KpiCharts({ registry, rows, period }: { registry: KpiRegistry; rows: StatsValueRow[]; period: string }) {
  const charts = registry.kpis
    .map((kpi) => ({ kpi, rows: rows.filter((row) => row.kpi_id === kpi.kpi_id && row.value !== null) }))
    .filter((entry) => entry.rows.length > 0);
  if (charts.length === 0) {
    return (
      <div className="empty-state" aria-live="polite">
        <p className="eyebrow">No chartable rows</p>
        <h2>No KPI values with data for period {period || "—"}</h2>
        <p>Every served row for this selection is a no-data row; the recorded coverage notes above explain why. No estimated series is drawn.</p>
      </div>
    );
  }
  return (
    <div className="chart-grid">
      {charts.map(({ kpi, rows: kpiRows }) => (
        <article className="panel" key={kpi.kpi_id}>
          <h3>{kpi.name}</h3>
          <EChart ariaLabel={`${kpi.name} served values for period ${period}`} option={barOption(kpi.name, kpiRows)} />
          <p className="cell-sub">Exact served rows for period {period}; segments as published by the gold rollup.</p>
        </article>
      ))}
    </div>
  );
}

function barOption(title: string, rows: StatsValueRow[]): EChartsCoreOption {
  const ordered = [...rows].sort((left, right) => segmentLabel(left).localeCompare(segmentLabel(right)));
  return {
    backgroundColor: "transparent",
    textStyle: { color: "#d9e7eb" },
    tooltip: { trigger: "axis" },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: ordered.map((row) => segmentLabel(row)),
      axisLabel: { color: "#b6ccd3", rotate: ordered.length > 4 ? 24 : 0 },
    },
    yAxis: { type: "value", axisLabel: { color: "#b6ccd3" }, splitLine: { lineStyle: { color: "rgba(210, 234, 239, 0.14)" } } },
    series: [
      {
        name: title,
        type: "bar",
        data: ordered.map((row) => row.value),
        itemStyle: { color: "#7de2dc" },
      },
    ],
  };
}

// GapPanel renders the API's documented statistics integration gaps — the
// honest record of figures the platform does not publish yet (and why),
// including the absence of emissions/MRV and blue-carbon KPIs from the
// published registry.
function GapPanel({ registry }: { registry: KpiRegistry }) {
  const publishedIds = new Set(registry.kpis.map((kpi) => kpi.kpi_id));
  const unpublished = [
    { id: "emissions-mrv", label: "Emissions / MRV summaries" },
    { id: "bluecarbon", label: "Blue-carbon totals" },
  ].filter((entry) => !publishedIds.has(entry.id));
  return (
    <article className="panel">
      <h3>Documented publication gaps</h3>
      <p className="panel-note">
        The statistics API registry is the authoritative list of published KPIs. The following summaries are <strong>not</strong> part of its published surface; this dashboard does not fabricate them:
      </p>
      <ul className="release-list">
        {unpublished.map((entry) => (
          <li key={entry.id}><strong>{entry.label}</strong> — not published by the statistics API at this deployment.</li>
        ))}
      </ul>
      {registry.gaps.length > 0 && (
        <>
          <p className="panel-note">Gaps recorded by the statistics API itself:</p>
          <ul className="release-list">
            {registry.gaps.map((gap) => (
              <li key={gap.gap_id}>
                <strong>{gap.gap_id}</strong> — {gap.description}
                <div className="cell-sub">Needed upstream: {gap.needed_upstream}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
