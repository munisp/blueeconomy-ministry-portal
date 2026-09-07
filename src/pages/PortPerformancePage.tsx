import { useCallback, useState } from "react";
import { useApiData } from "../hooks/useApiData";
import {
  KPI_ENDPOINTS,
  PORT_PERFORMANCE_METRIC_LABELS,
  PORT_PERFORMANCE_PERIODS,
  exportImportBalanceTonnes,
  fetchPortPerformanceReport,
  fetchPortPerformanceReportPdf,
  type PortPerformanceMetric,
  type PortPerformanceMetrics,
  type PortPerformancePeriod,
} from "../kpi-client";
import { ApiError } from "../api-client";
import { DashboardFrame, KpiCard, KpiGrid, formatNumber } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

type ExportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; filename: string; signature: string; algorithm: string | null }
  | { kind: "error"; error: string };

function formatDelta(metric: PortPerformanceMetric): string | undefined {
  if (metric.delta_pct === null) {
    return undefined;
  }
  const sign = metric.delta_pct > 0 ? "+" : "";
  return `${sign}${metric.delta_pct.toFixed(1)}% vs previous period`;
}

function formatValue(metric: PortPerformanceMetric): string {
  return `${formatNumber(metric.value as number)} ${metric.unit}`;
}

/**
 * NPA-style port performance report, aggregated and served by the approved
 * backend from live data sources. Fail-closed: any metric the backend marks
 * as having no data for the selected period renders an explicit empty state;
 * no figure is ever fabricated locally. The PDF export is compiled and
 * JWS-signed (EdDSA) by the backend, following the weekly-briefing pattern;
 * unsigned or malformed responses are refused.
 */
export function PortPerformancePage({ baseUrl, token }: DashboardPageProps) {
  const [period, setPeriod] = useState<PortPerformancePeriod>("weekly");
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });

  const loader = useCallback(
    () =>
      token === null
        ? Promise.reject(new Error("authentication required"))
        : fetchPortPerformanceReport(baseUrl, token, period),
    [baseUrl, token, period],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  async function requestSignedPdf(): Promise<void> {
    if (token === null) {
      setExportState({ kind: "error", error: "authentication required" });
      return;
    }
    setExportState({ kind: "loading" });
    try {
      const signed = await fetchPortPerformanceReportPdf(baseUrl, token, period);
      if (signed.signature === null) {
        throw new ApiError("invalid-payload", "backend returned an unsigned report; refusing to present it");
      }
      const url = URL.createObjectURL(signed.blob);
      const anchor = document.createElement("a");
      const filename = `port-performance-${period}-${new Date().toISOString().slice(0, 10)}.pdf`;
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportState({ kind: "ready", filename, signature: signed.signature, algorithm: signed.signatureAlgorithm });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setExportState({
          kind: "error",
          error: `The signed report endpoint (GET ${KPI_ENDPOINTS.portPerformanceReportPdf}) is not available on the approved backend (HTTP 404). No report has been generated locally.`,
        });
      } else {
        setExportState({ kind: "error", error: error instanceof Error ? error.message : "report export failed" });
      }
    }
  }

  function renderMetricCard(key: keyof PortPerformanceMetrics, metrics: PortPerformanceMetrics) {
    const metric = metrics[key];
    const label = PORT_PERFORMANCE_METRIC_LABELS[key];
    if (metric.value === null) {
      return (
        <KpiCard
          key={key}
          label={label}
          value="No data available for this period"
          detail={`Source: ${metric.source}`}
          tone="warning"
        />
      );
    }
    return (
      <KpiCard key={key} label={label} value={formatValue(metric)} detail={formatDelta(metric) ?? `Source: ${metric.source}`} />
    );
  }

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Port performance</p>
          <h2>NPA-style port performance report</h2>
        </div>
        <p className="section-note">
          Cargo throughput, vessel calls, TEU movements, transshipment and export/import balance — aggregated live
          from named backend data sources. Metrics with no underlying data are shown as unavailable, never estimated.
        </p>
      </div>

      <div className="briefing-panel">
        <div className="period-selector" role="group" aria-label="Reporting period">
          {PORT_PERFORMANCE_PERIODS.map((option) => (
            <button
              key={option}
              className={`button ${option === period ? "" : "button--quiet"}`}
              aria-pressed={option === period}
              onClick={() => {
                setPeriod(option);
                setExportState({ kind: "idle" });
              }}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>

        <DashboardFrame state={state} loadingLabel="Aggregating port performance" onRetry={reload}>
          {(report) => {
            const balance = exportImportBalanceTonnes(report.metrics);
            return (
              <>
                <p className="dashboard-period">
                  {report.period} report — period: {report.period_start} → {report.period_end} (generated{" "}
                  {report.generated_at})
                </p>
                <KpiGrid>
                  {(Object.keys(PORT_PERFORMANCE_METRIC_LABELS) as (keyof PortPerformanceMetrics)[]).map((key) =>
                    renderMetricCard(key, report.metrics),
                  )}
                  {balance === null ? (
                    <KpiCard
                      label="Export/import balance"
                      value="No data available for this period"
                      detail="Requires both export and import tonnage"
                      tone="warning"
                    />
                  ) : (
                    <KpiCard
                      label="Export/import balance"
                      value={`${balance >= 0 ? "+" : ""}${formatNumber(balance)} tonnes`}
                      detail="export − import"
                      tone={balance >= 0 ? "success" : "neutral"}
                    />
                  )}
                </KpiGrid>
              </>
            );
          }}
        </DashboardFrame>

        <div className="briefing-panel">
          <p>
            The PDF export is compiled and digitally signed (JWS, EdDSA) by the platform backend. This portal never
            assembles report content itself; unsigned or malformed responses are refused.
          </p>
          <button
            className="button"
            disabled={token === null || exportState.kind === "loading" || state.status !== "ready"}
            onClick={() => void requestSignedPdf()}
          >
            {exportState.kind === "loading"
              ? "Requesting signed report…"
              : token === null
                ? "Sign in to export"
                : `Export signed ${period} report (PDF)`}
          </button>
          {exportState.kind === "ready" && (
            <p className="briefing-evidence" aria-live="polite">
              Downloaded {exportState.filename}. JWS signature present ({exportState.algorithm ?? "algorithm not declared"})
              — cryptographic verification is anchored at the backend signing key.
            </p>
          )}
          {exportState.kind === "error" && (
            <div className="empty-state empty-state--alert" role="alert">
              <p className="eyebrow">Report export unavailable</p>
              <pre>{exportState.error}</pre>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
