import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchRiskModelMetrics } from "../kpi-client";
import { DashboardFrame, KpiCard, KpiGrid, formatNumber, formatPercent } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

export function RiskModelPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchRiskModelMetrics(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Risk model</p>
          <h2>Targeting model performance</h2>
        </div>
        <p className="section-note">Discrimination and hit-rate metrics for the production risk-targeting model.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading risk model metrics" onRetry={reload}>
        {(metrics) => (
          <>
            <p className="dashboard-period">Model {metrics.model_version} — evaluated {new Date(metrics.evaluated_at).toLocaleString()}</p>
            <KpiGrid>
              <KpiCard label="AUC" value={metrics.auc.toFixed(3)} />
              <KpiCard label="Precision" value={formatPercent(metrics.precision * 100)} />
              <KpiCard label="Recall" value={formatPercent(metrics.recall * 100)} />
              <KpiCard label="Alerts generated" value={formatNumber(metrics.alerts_generated)} />
              <KpiCard label="Hit rate" value={formatPercent(metrics.hit_rate_pct)} tone="success" />
            </KpiGrid>
          </>
        )}
      </DashboardFrame>
    </section>
  );
}
