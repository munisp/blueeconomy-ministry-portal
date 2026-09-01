import type { ReactNode } from "react";
import type { ApiDataState } from "../hooks/useApiData";

export function formatNaira(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `₦${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `₦${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `₦${(value / 1_000).toFixed(1)}K`;
  }
  return `₦${value.toLocaleString()}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

interface KpiCardProperties {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export function KpiCard({ label, value, detail, tone = "neutral" }: KpiCardProperties) {
  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__value">{value}</p>
      {detail !== undefined && <p className="kpi-card__detail">{detail}</p>}
    </article>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="kpi-grid">{children}</div>;
}

export function DashboardLoading({ label }: { label: string }) {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Live backend request</p>
      <h2>{label}</h2>
      <p>Waiting for the authorised backend response. No cached or synthetic figures are shown.</p>
    </section>
  );
}

export function DashboardError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Backend unavailable</p>
      <h2>Live data could not be retrieved</h2>
      <p>This surface fails closed: no figures are displayed unless the authorised backend returned them.</p>
      <pre>{error}</pre>
      {onRetry !== undefined && (
        <p>
          <button className="button button--outline" onClick={onRetry}>Retry request</button>
        </p>
      )}
    </section>
  );
}

interface DashboardFrameProperties<T> {
  state: ApiDataState<T>;
  loadingLabel: string;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}

export function DashboardFrame<T>({ state, loadingLabel, onRetry, children }: DashboardFrameProperties<T>) {
  if (state.status === "idle" || state.status === "loading") {
    return <DashboardLoading label={loadingLabel} />;
  }
  if (state.status === "error") {
    return <DashboardError error={state.error} onRetry={onRetry} />;
  }
  return <>{children(state.data)}</>;
}

interface DataTableProperties {
  columns: string[];
  rows: ReactNode[][];
  caption: string;
  emptyMessage?: string;
}

export function DataTable({ columns, rows, caption, emptyMessage = "No records returned by the backend." }: DataTableProperties) {
  if (rows.length === 0) {
    return <p className="table-empty">{emptyMessage}</p>;
  }
  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatusPill({ tone, children }: { tone: "neutral" | "success" | "warning" | "danger"; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}
