import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchCustomsSummary } from "../kpi-client";
import { DashboardFrame, DataTable, formatNaira, formatNumber, formatPercent } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

export function CustomsNrsPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchCustomsSummary(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Customs / NCS–NRS</p>
          <h2>Revenue agency performance</h2>
        </div>
        <p className="section-note">Per-agency collection, processing, interception and compliance as reported by the single window.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading customs and revenue agency summary" onRetry={reload}>
        {(report) => (
          <DataTable
            caption={`Agency summary observed at ${new Date(report.generated_at).toLocaleString()}`}
            columns={["Agency", "Revenue collected", "Declarations processed", "Interceptions", "Compliance"]}
            rows={report.agencies.map((agency) => [
              agency.agency,
              formatNaira(agency.revenue_collected_ngn),
              formatNumber(agency.declarations_processed),
              formatNumber(agency.interceptions),
              formatPercent(agency.compliance_pct),
            ])}
          />
        )}
      </DashboardFrame>
    </section>
  );
}
