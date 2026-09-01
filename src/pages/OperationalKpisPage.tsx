import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchOperationalKpis } from "../kpi-client";
import { DashboardFrame, KpiCard, KpiGrid, formatNumber } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

const STATUS_TONE = { "on-track": "success", "at-risk": "warning", breach: "danger" } as const;

export function OperationalKpisPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchOperationalKpis(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operational KPIs</p>
          <h2>Service-level operating indicators</h2>
        </div>
        <p className="section-note">Every indicator is a live backend observation with its target and breach status.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading operational KPIs" onRetry={reload}>
        {(report) => (
          <>
            <p className="dashboard-period">Observed at {new Date(report.generated_at).toLocaleString()}</p>
            <KpiGrid>
              {report.entries.map((entry) => (
                <KpiCard
                  key={entry.id}
                  label={entry.label}
                  value={`${formatNumber(entry.value)} ${entry.unit}`}
                  detail={entry.target === null ? entry.status : `target ${formatNumber(entry.target)} ${entry.unit} — ${entry.status}`}
                  tone={STATUS_TONE[entry.status]}
                />
              ))}
            </KpiGrid>
          </>
        )}
      </DashboardFrame>
    </section>
  );
}
