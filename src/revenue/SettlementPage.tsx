// Settlement view (W-FEAT-9 scope item 3): operator settlement batches from
// ferry-ticketing GET /v1/reports/settlement (operatorId + period), plus a
// port-interoperability booking payment-receipt lookup (GET
// /v1/bookings/{id}) covering the receipt/refund rail state.
//
// Exactly-once honesty: the upstream store settles one (operator, period)
// key exactly once and the aggregate names that key — the view shows the
// settlement reference key as recorded. The executed run record (run id,
// ledger transfer ids) is returned only by the state-officer POST
// /v1/fare/settlements/run; there is no GET for executed runs, so that read
// surface is declared as an integration gap rather than reconstructed.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RevenueRuntimeConfiguration } from "../runtime-config";
import { classifyRevenueError, fetchBookingReceipt, fetchSettlementReport } from "./revenue-client";
import type { BookingRecord, RevenuePanelError, SettlementAggregate } from "./revenue-model";
import { bookingReceiptProvenance, resolveDateRange, settlementReportProvenance } from "./revenue-model";
import { DateRangeControls, defaultRange, formatMinor, PanelStateView, ProvenanceNote } from "./revenue-ui";

interface Properties {
  configuration: RevenueRuntimeConfiguration;
  token: string;
  onUnauthorized: () => void;
}

type SettlementState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; aggregate: SettlementAggregate; observedAt: string };

export function SettlementPage({ configuration, token, onUnauthorized }: Properties) {
  const initial = defaultRange();
  const [operatorId, setOperatorId] = useState("");
  const [submittedOperator, setSubmittedOperator] = useState<string | null>(null);
  const [from, setFrom] = useState(initial.from);
  const [toInclusive, setTo] = useState(initial.toInclusive);
  const [state, setState] = useState<SettlementState>({ kind: "idle" });

  const range = useMemo(() => resolveDateRange(from, toInclusive), [from, toInclusive]);

  const load = useCallback(async () => {
    if (submittedOperator === null || typeof range === "string") {
      return;
    }
    setState({ kind: "loading" });
    try {
      const aggregate = await fetchSettlementReport(configuration, token, submittedOperator, range.from, range.toExclusive);
      setState({ kind: "ready", aggregate, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }, [configuration, token, submittedOperator, range, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  function submit(): void {
    const trimmed = operatorId.trim();
    if (trimmed === "") {
      return;
    }
    setSubmittedOperator(trimmed);
  }

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BlueFare settlements</p>
          <h2>Operator settlement view</h2>
        </div>
        <p className="section-note">Usage-attributed revenue split for one operator and period, read from the ferry-ticketing settlement report.</p>
      </div>

      <div className="queue-controls revenue-controls">
        <label>
          Operator id
          <input type="text" value={operatorId} placeholder="Recorded operator identifier" onChange={(event) => setOperatorId(event.target.value)} />
        </label>
        <button className="button button--outline revenue-inline-button" disabled={operatorId.trim() === ""} onClick={submit}>Read settlement</button>
      </div>
      <DateRangeControls from={from} toInclusive={toInclusive} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
      {typeof range === "string" && (
        <p className="validation-errors" role="alert">Date range invalid: {range}. No query is issued until the range is valid.</p>
      )}

      {state.kind === "idle" && (
        <section className="empty-state" aria-live="polite">
          <p className="eyebrow">Operator required</p>
          <h2>Enter a recorded operator id to read its settlement</h2>
          <p>The settlement report is operator-scoped upstream; the portal does not guess or enumerate operator ids. No figure appears before an authorised read returns.</p>
        </section>
      )}
      {state.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
      {state.kind === "error" && <PanelStateView state={state.error} onRetry={() => void load()} />}
      {state.kind === "ready" && <SettlementReady aggregate={state.aggregate} observedAt={state.observedAt} />}

      <section className="assurance-banner revenue-gap-banner" aria-label="Declared limits of this view">
        <span className="assurance-mark">Declared limits</span>
        <div>
          <p>Executed settlement run records (run id, ledger transfer ids, executing principal) are returned only by the state-officer POST /v1/fare/settlements/run; no GET read surface exists for executed runs. The exactly-once reference shown here is the recorded (operator, period) settlement key, not a reconstructed run id.</p>
          <p>There is no cross-operator settlement list endpoint; each read is one operator and one period.</p>
        </div>
      </section>

      <BookingReceiptLookup configuration={configuration} token={token} onUnauthorized={onUnauthorized} />
    </section>
  );
}

function SettlementReady({ aggregate, observedAt }: { aggregate: SettlementAggregate; observedAt: string }) {
  const provenance = settlementReportProvenance(aggregate.operatorId, aggregate.periodStart, aggregate.periodEnd);
  return (
    <>
      <div className="detail-grid revenue-totals">
        <dt>Exactly-once settlement key</dt>
        <dd className="detail-mono">{aggregate.operatorId} / {aggregate.periodStart} → {aggregate.periodEnd}</dd>
        <dt>Rides attributed</dt><dd>{aggregate.rides.toLocaleString("en-NG")}</dd>
        <dt>Gross revenue</dt><dd>{formatMinor(aggregate.grossNgnMinor, "NGN")}</dd>
        <dt>Subsidy within period</dt><dd>{formatMinor(aggregate.subsidyNgnMinor, "NGN")}</dd>
        <dt>Operator share ({aggregate.operatorShareBps} bps)</dt><dd>{formatMinor(aggregate.operatorShareNgnMinor, "NGN")}</dd>
        <dt>Platform share</dt><dd>{formatMinor(aggregate.platformShareNgnMinor, "NGN")}</dd>
      </div>
      {aggregate.rides === 0 && (
        <p className="queue-note" role="status">The endpoint answered with a recorded aggregate of zero rides for this operator and period — an observed empty period, not an outage.</p>
      )}
      <ProvenanceNote provenance={provenance} observedAt={observedAt} />
    </>
  );
}

type ReceiptState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; booking: BookingRecord; observedAt: string };

// BookingReceiptLookup is the port-interoperability drill-through: one
// booking record carries the payment receipt reference, the paid/refunded
// status and the ledger commit hash. There is no booking list endpoint
// upstream, so the lookup is by recorded booking id only.
function BookingReceiptLookup({ configuration, token, onUnauthorized }: Properties) {
  const [bookingId, setBookingId] = useState("");
  const [state, setState] = useState<ReceiptState>({ kind: "idle" });

  async function lookup(): Promise<void> {
    const trimmed = bookingId.trim();
    if (trimmed === "") {
      return;
    }
    setState({ kind: "loading" });
    try {
      const booking = await fetchBookingReceipt(configuration, token, trimmed);
      setState({ kind: "ready", booking, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }

  return (
    <section className="receipt-lookup">
      <h3 className="revenue-subheading">Port booking payment receipt</h3>
      <p className="queue-note">Reads one booking record from port-interoperability. A paid booking shows its switch-issued receipt reference; a refunded booking shows the terminal REFUNDED state of the compensating refund rail.</p>
      <div className="queue-controls revenue-controls">
        <label>
          Booking id
          <input type="text" value={bookingId} placeholder="Recorded booking identifier" onChange={(event) => setBookingId(event.target.value)} />
        </label>
        <button className="button button--outline revenue-inline-button" disabled={bookingId.trim() === ""} onClick={() => void lookup()}>Read receipt</button>
      </div>
      {state.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
      {state.kind === "error" && <PanelStateView state={state.error} onRetry={() => void lookup()} />}
      {state.kind === "ready" && (
        <>
          <div className="detail-grid revenue-totals">
            <dt>Booking</dt><dd className="detail-mono">{state.booking.booking_id}</dd>
            <dt>Status</dt><dd><span className={`status-chip status-chip--${state.booking.status.toLowerCase()}`}>{state.booking.status}</span></dd>
            <dt>Amount</dt><dd>{formatMinor(state.booking.amount_kobo, state.booking.currency)}</dd>
            <dt>Payment receipt ref</dt><dd className="detail-mono">{state.booking.payment_receipt_ref ?? "none recorded"}</dd>
            <dt>Ledger commit hash</dt><dd className="detail-mono">{state.booking.ledger_commit_hash ?? "none recorded"}</dd>
            <dt>Terminal</dt><dd className="detail-mono">{state.booking.terminal_id}</dd>
            <dt>Recorded</dt><dd>{new Date(state.booking.created_at).toLocaleString()} (version {state.booking.version})</dd>
          </div>
          <ProvenanceNote provenance={bookingReceiptProvenance(state.booking.booking_id)} observedAt={state.observedAt} />
        </>
      )}
    </section>
  );
}
