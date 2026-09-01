import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { fetchTradeAnalytics } from "../kpi-client";
import { DashboardFrame, DataTable, KpiCard, KpiGrid, formatNaira, formatNumber } from "../components/dashboard";
import type { DashboardPageProps } from "./props";

export function TradeAnalyticsPage({ baseUrl, token }: DashboardPageProps) {
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchTradeAnalytics(baseUrl, token, 30)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Trade analytics</p>
          <h2>Declarations and duty flows</h2>
        </div>
        <p className="section-note">Rolling 30-day window of declarations, duty collection and leading HS chapters.</p>
      </div>
      <DashboardFrame state={state} loadingLabel="Loading trade analytics" onRetry={reload}>
        {(report) => (
          <>
            <KpiGrid>
              <KpiCard label={`Declarations (${report.window_days}d)`} value={formatNumber(report.total_declarations)} />
              <KpiCard label={`Duty collected (${report.window_days}d)`} value={formatNaira(report.total_duty_ngn)} tone="success" />
            </KpiGrid>
            <h3>Top HS chapters</h3>
            <DataTable
              caption="Leading HS chapters by declarations"
              columns={["HS chapter", "Declarations", "Duty"]}
              rows={report.top_hs_chapters.map((chapter) => [chapter.chapter, formatNumber(chapter.declarations), formatNaira(chapter.duty_ngn)])}
            />
            <h3>Daily flow</h3>
            <DataTable
              caption="Daily declarations and duty"
              columns={["Date", "Declarations", "Duty"]}
              rows={report.daily.map((day) => [day.date, formatNumber(day.declarations), formatNaira(day.duty_ngn)])}
            />
          </>
        )}
      </DashboardFrame>
    </section>
  );
}
