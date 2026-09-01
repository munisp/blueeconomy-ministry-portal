import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchSlaBreaches } from "../kpi-client";
import { DashboardFrame, DataTable, StatusPill } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

export function SlaBreachPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchSlaBreaches(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SLA breaches</p>
          <h2>Clearance-stage service-level breaches</h2>
        </div>
        <p className="section-note">Live breach register across participating agencies. Empty means the backend reported no open breaches.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading SLA breach register" onRetry={reload}>
        {(report) => (
          <DataTable
            caption={`Breach register observed at ${new Date(report.generated_at).toLocaleString()}`}
            columns={["Reference", "Service", "Stage", "SLA (h)", "Elapsed (h)", "Severity"]}
            rows={report.breaches.map((breach) => [
              breach.reference,
              breach.service,
              breach.stage,
              breach.sla_hours.toString(),
              breach.elapsed_hours.toFixed(1),
              <StatusPill tone={breach.severity === "critical" ? "danger" : "warning"}>{breach.severity}</StatusPill>,
            ])}
            emptyMessage="The backend reported no open SLA breaches."
          />
        )}
      </DashboardFrame>
    </section>
  );
}
