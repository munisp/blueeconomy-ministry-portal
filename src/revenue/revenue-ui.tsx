// Shared honest-state rendering for the revenue dashboards (W-FEAT-9).
// Every panel resolves to exactly one observed state: loading, endpoint-down
// (retryable), unauthorized, forbidden, no-data, integration-gap or ready.
// No state fabricates or substitutes data.

import type { Agency, DateRange, PanelState, Provenance } from "./revenue-model";
import { AGENCIES, describeProvenance } from "./revenue-model";

/** formatMinor renders integer minor units as major-unit text with the
 * currency code (no locale currency symbols are assumed; NGN kobo and USD
 * cents both divide by 100). */
export function formatMinor(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;
  return `${sign}${major.toLocaleString("en-NG")}.${String(minor).padStart(2, "0")} ${currency}`;
}

export function ProvenanceNote({ provenance, observedAt }: { provenance: Provenance; observedAt?: string }) {
  return (
    <p className="provenance-note">
      Source: <code>{describeProvenance(provenance)}</code>
      {observedAt !== undefined ? ` — observed ${new Date(observedAt).toLocaleString()}` : ""}
    </p>
  );
}

export function PanelStateView({ state, onRetry }: { state: PanelState; onRetry?: () => void }) {
  if (state.kind === "ready") {
    return null;
  }
  if (state.kind === "loading") {
    return (
      <section className="empty-state" aria-live="polite">
        <p className="eyebrow">Authorised call in flight</p>
        <h2>Reading the revenue endpoints</h2>
        <p>The dashboard is waiting for the upstream service. No cached or substitute figures are shown.</p>
      </section>
    );
  }
  if (state.kind === "no-data") {
    return (
      <section className="empty-state" aria-live="polite">
        <p className="eyebrow">Observed empty result</p>
        <h2>The endpoint answered with no matching records</h2>
        <p>{state.detail} This is an observed no-data result from the upstream service, not a placeholder and not an outage.</p>
      </section>
    );
  }
  if (state.kind === "integration-gap") {
    return (
      <section className="empty-state empty-state--alert" aria-live="polite">
        <p className="eyebrow">Integration gap</p>
        <h2>This read surface is not wired upstream</h2>
        <p>{state.detail}</p>
      </section>
    );
  }
  if (state.kind === "unauthorized") {
    return (
      <section className="empty-state empty-state--alert" role="alert">
        <p className="eyebrow">Session expired</p>
        <h2>The upstream service rejected the session token (HTTP 401)</h2>
        <p>{state.detail} Sign in again through the approved identity authority.</p>
      </section>
    );
  }
  if (state.kind === "forbidden") {
    return (
      <section className="empty-state empty-state--alert" role="alert">
        <p className="eyebrow">Access denied by the upstream service</p>
        <h2>Your roles or tenancy do not cover this record (HTTP 403)</h2>
        <p>{state.detail}</p>
      </section>
    );
  }
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Endpoint down</p>
      <h2>The upstream endpoint did not return usable data</h2>
      <p>{state.detail} The dashboard distinguishes this outage from a no-data result and shows no substitute figures.</p>
      {state.retryable && onRetry !== undefined && (
        <button className="button button--outline" onClick={onRetry}>Retry the authorised call</button>
      )}
    </section>
  );
}

interface DateRangeControlsProperties {
  from: string;
  toInclusive: string;
  onChange: (from: string, toInclusive: string) => void;
}

export function DateRangeControls({ from, toInclusive, onChange }: DateRangeControlsProperties) {
  return (
    <div className="queue-controls revenue-controls">
      <label>
        From (inclusive)
        <input type="date" value={from} onChange={(event) => onChange(event.target.value, toInclusive)} />
      </label>
      <label>
        To (inclusive)
        <input type="date" value={toInclusive} onChange={(event) => onChange(from, event.target.value)} />
      </label>
    </div>
  );
}

export type AgencyFilter = Agency | "ALL";

export function AgencyFilterSelect({ value, onChange }: { value: AgencyFilter; onChange: (agency: AgencyFilter) => void }) {
  return (
    <label>
      Agency filter
      <select value={value} onChange={(event) => onChange(event.target.value as AgencyFilter)}>
        <option value="ALL">All agencies</option>
        {AGENCIES.map((agency) => <option key={agency} value={agency}>{agency}</option>)}
      </select>
    </label>
  );
}

/** defaultRange: the last 30 days inclusive, derived from the clock at
 * render time (never hardcoded). */
export function defaultRange(now: Date = new Date()): { from: string; toInclusive: string } {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { from: start, toInclusive: end };
}

export function RangeSummary({ range }: { range: DateRange }) {
  return (
    <p className="section-note">
      Query window {range.from} to {range.toInclusive} inclusive (sent upstream as [{range.from}, {range.toExclusive})).
    </p>
  );
}

/** BarPair is one low-saturation two-tone comparison bar (observed vs
 * reference amounts); widths are proportions of the larger value. */
export function BarPair({ label, primary, secondary, primaryText, secondaryText }: {
  label: string;
  primary: number;
  secondary: number;
  primaryText: string;
  secondaryText: string;
}) {
  const maximum = Math.max(primary, secondary, 1);
  return (
    <div className="bar-pair" role="img" aria-label={`${label}: ${primaryText}; ${secondaryText}`}>
      <span className="bar-pair__label">{label}</span>
      <span className="bar-pair__track">
        <span className="bar-pair__bar bar-pair__bar--primary" style={{ width: `${Math.max(2, (primary / maximum) * 100)}%` }} />
        <span className="bar-pair__value">{primaryText}</span>
      </span>
      <span className="bar-pair__track">
        <span className="bar-pair__bar bar-pair__bar--secondary" style={{ width: `${Math.max(2, (secondary / maximum) * 100)}%` }} />
        <span className="bar-pair__value">{secondaryText}</span>
      </span>
    </div>
  );
}
