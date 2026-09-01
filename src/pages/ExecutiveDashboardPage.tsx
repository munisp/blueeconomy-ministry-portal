import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchMinisterialKpiPack, fetchOperationalKpis } from "../kpi-client";
import {
  DashboardFrame, DataTable, KpiCard, KpiGrid, StatusPill,
  formatNaira, formatNumber, formatPercent,
} from "../components/dashboard";
import type { DashboardPageProps } from "./props";

const STATUS_TONE = { "on-track": "success", "at-risk": "warning", breach: "danger" } as const;

export function ExecutiveDashboardPage({ baseUrl, token }: DashboardPageProps) {
  const kpiLoader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchMinisterialKpiPack(baseUrl, token)),
    [baseUrl, token],
  );
  const opsLoader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchOperationalKpis(baseUrl, token)),
    [baseUrl, token],
  );
  const kpi = useApiData(token === null ? null : kpiLoader);
  const ops = useApiData(token === null ? null : opsLoader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Executive dashboard</p>
          <h2>Revenue and clearance posture</h2>
        </div>
        <p className="section-note">Live counters from the national single window. Figures render only from authorised backend responses.</p>
      </div>
      <DashboardFrame state={kpi.state} loadingLabel="Loading executive KPI summary" onRetry={kpi.reload}>
        {(pack) => (
          <KpiGrid>
            <KpiCard label="Revenue collected" value={formatNaira(pack.revenue_collected_ngn)} detail={`${pack.period_start} → ${pack.period_end}`} tone="success" />
            <KpiCard label="Declarations cleared" value={formatNumber(pack.declarations_cleared)} />
            <KpiCard label="Avg clearance time" value={`${pack.avg_clearance_hours.toFixed(1)} h`} />
            <KpiCard label="SLA compliance" value={formatPercent(pack.sla_compliance_pct)} />
          </KpiGrid>
        )}
      </DashboardFrame>
      <h3>Operational indicators</h3>
      <DashboardFrame state={ops.state} loadingLabel="Loading operational indicators" onRetry={ops.reload}>
        {(report) => (
          <DataTable
            caption={`Operational KPIs observed at ${new Date(report.generated_at).toLocaleString()}`}
            columns={["Indicator", "Value", "Target", "Status"]}
            rows={report.entries.map((entry) => [
              entry.label,
              `${formatNumber(entry.value)} ${entry.unit}`,
              entry.target === null ? "—" : `${formatNumber(entry.target)} ${entry.unit}`,
              <StatusPill tone={STATUS_TONE[entry.status]}>{entry.status}</StatusPill>,
            ])}
          />
        )}
      </DashboardFrame>
    </section>
  );
}
