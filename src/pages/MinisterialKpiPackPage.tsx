import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchMinisterialKpiPack } from "../kpi-client";
import { DashboardFrame, KpiCard, KpiGrid, formatNaira, formatNumber, formatPercent } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

export function MinisterialKpiPackPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchMinisterialKpiPack(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ministerial KPI pack</p>
          <h2>Consolidated executive indicators</h2>
        </div>
        <p className="section-note">Revenue, clearance, interceptions, coverage and SLA compliance — sourced live from the single-window backend.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading consolidated KPI pack" onRetry={reload}>
        {(pack) => (
          <>
            <p className="dashboard-period">Reporting period: {pack.period_start} → {pack.period_end}</p>
            <KpiGrid>
              <KpiCard label="Revenue collected" value={formatNaira(pack.revenue_collected_ngn)} tone="success" />
              <KpiCard label="Declarations cleared" value={formatNumber(pack.declarations_cleared)} />
              <KpiCard label="Avg clearance time" value={`${pack.avg_clearance_hours.toFixed(1)} h`} />
              <KpiCard label="Interceptions" value={formatNumber(pack.interceptions)} tone="warning" />
              <KpiCard label="Coverage" value={formatPercent(pack.coverage_pct)} />
              <KpiCard
                label="SLA compliance"
                value={formatPercent(pack.sla_compliance_pct)}
                tone={pack.sla_compliance_pct >= 95 ? "success" : pack.sla_compliance_pct >= 85 ? "warning" : "danger"}
              />
            </KpiGrid>
          </>
        )}
      </DashboardFrame>
    </section>
  );
}
