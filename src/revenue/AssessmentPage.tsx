// Assessment/tariff view (W-FEAT-9 scope item 4): the versioned statutory
// rate registry by revenue line (NPA / NIMASA / SPL / CVFF-domain / NIWA
// instruments as recorded in the data), assessment drill-through by id, and
// first-class exemption audit trails (NLNG lesson: every applied exemption
// links to its per-application audit records).
//
// Wired only to financial-controls endpoints that exist @ 3bff518:
//   GET /v1/tariffs/rates
//   GET /v1/tariffs/assessments/{id}
//   GET /v1/tariffs/assessments/{id}/exemption-audits
// There is no assessment list/search endpoint upstream, so assessment drill-
// through is by recorded assessment id — declared in-page, never worked
// around.

import { useCallback, useEffect, useState } from "react";
import type { RevenueRuntimeConfiguration } from "../runtime-config";
import { classifyRevenueError, fetchAssessment, fetchExemptionAudits, fetchTariffRates } from "./revenue-client";
import type { Assessment, ExemptionAudit, RevenuePanelError, TariffRateRow } from "./revenue-model";
import {
  assessmentProvenance,
  exemptionAuditsProvenance,
  filterLinesByAgency,
  filterRatesByAgency,
  tariffRatesProvenance,
} from "./revenue-model";
import { AgencyFilterSelect, formatMinor, PanelStateView, ProvenanceNote, type AgencyFilter } from "./revenue-ui";

interface Properties {
  configuration: RevenueRuntimeConfiguration;
  token: string;
  onUnauthorized: () => void;
}

type RatesState =
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; rates: TariffRateRow[]; observedAt: string };

const STATE_FILTERS = ["ALL", "DRAFT", "ACTIVE", "RETIRED"] as const;

export function AssessmentPage({ configuration, token, onUnauthorized }: Properties) {
  const [agency, setAgency] = useState<AgencyFilter>("ALL");
  const [rateState, setRateState] = useState<(typeof STATE_FILTERS)[number]>("ALL");
  const [state, setState] = useState<RatesState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const result = await fetchTariffRates(configuration, token);
      setState({ kind: "ready", rates: result.rates, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }, [configuration, token, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Statutory tariffs</p>
          <h2>Assessments and rate registry</h2>
        </div>
        <p className="section-note">Versioned, maker/checker-approved rate rows and immutable assessments from the financial-controls tariff engine.</p>
      </div>

      <div className="queue-controls revenue-controls">
        <AgencyFilterSelect value={agency} onChange={setAgency} />
        <label>
          Rate state
          <select value={rateState} onChange={(event) => setRateState(event.target.value as (typeof STATE_FILTERS)[number])}>
            {STATE_FILTERS.map((candidate) => <option key={candidate} value={candidate}>{candidate === "ALL" ? "All states" : candidate}</option>)}
          </select>
        </label>
        <button className="button button--quiet" onClick={() => void load()}>Refresh</button>
      </div>

      {state.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
      {state.kind === "error" && <PanelStateView state={state.error} onRetry={() => void load()} />}
      {state.kind === "ready" && <RateRegistry rates={state.rates} agency={agency} rateState={rateState} observedAt={state.observedAt} />}

      <AssessmentLookup configuration={configuration} token={token} onUnauthorized={onUnauthorized} agency={agency} />
    </section>
  );
}

function RateRegistry({ rates, agency, rateState, observedAt }: { rates: TariffRateRow[]; agency: AgencyFilter; rateState: (typeof STATE_FILTERS)[number]; observedAt: string }) {
  const byAgency = filterRatesByAgency(rates, agency);
  const visible = rateState === "ALL" ? byAgency : byAgency.filter((rate) => rate.State === rateState);
  if (rates.length === 0) {
    return (
      <>
        <PanelStateView state={{ kind: "no-data", detail: "The tariff engine returned an empty rate registry." }} />
        <ProvenanceNote provenance={tariffRatesProvenance()} observedAt={observedAt} />
      </>
    );
  }
  return (
    <>
      <h3 className="revenue-subheading">Versioned rate registry ({visible.length} of {rates.length} rows)</h3>
      {visible.length === 0 ? (
        <p className="queue-note" role="status">No registry rows match the current agency/state filters over the observed {rates.length} rows.</p>
      ) : (
        <table className="queue-table revenue-table">
          <thead>
            <tr>
              <th scope="col">Rate id</th>
              <th scope="col">Revenue line</th>
              <th scope="col">Agency</th>
              <th scope="col">Rate</th>
              <th scope="col">Effective window</th>
              <th scope="col">State</th>
              <th scope="col">Maker / checker</th>
              <th scope="col">Statutory reference</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((rate) => (
              <tr key={rate.RateID}>
                <td className="detail-mono">{rate.RateID}{rate.Provisional ? " (provisional)" : ""}</td>
                <td>{rate.Instrument}</td>
                <td>{rate.Agency}</td>
                <td>{describeRate(rate)}</td>
                <td>{rate.EffectiveFrom.slice(0, 10)} → {rate.EffectiveTo === null ? "open" : rate.EffectiveTo.slice(0, 10)}</td>
                <td><span className={`status-chip status-chip--${rate.State.toLowerCase()}`}>{rate.State}</span></td>
                <td className="detail-mono">{rate.Maker}{rate.Checker === "" ? " / (awaiting checker)" : ` / ${rate.Checker}`}</td>
                <td>{rate.StatutoryReference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ProvenanceNote provenance={tariffRatesProvenance()} observedAt={observedAt} />
    </>
  );
}

function describeRate(rate: TariffRateRow): string {
  if (rate.RateBps > 0) {
    return `${(rate.RateBps / 100).toLocaleString("en-NG")}% of basis (${rate.Currency})`;
  }
  if (rate.RateMinorPerUnit > 0) {
    return `${formatMinor(rate.RateMinorPerUnit, rate.Currency)} per unit (band floor ${rate.BandFloor.toLocaleString("en-NG")}${rate.BandCeiling === null ? ", open ceiling" : `, ceiling ${rate.BandCeiling.toLocaleString("en-NG")}`})`;
  }
  return `no monetary rate recorded (${rate.BandLogic})`;
}

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; assessment: Assessment; observedAt: string };

type AuditState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: RevenuePanelError }
  | { kind: "ready"; audits: ExemptionAudit[]; assessmentId: string; observedAt: string };

function AssessmentLookup({ configuration, token, onUnauthorized, agency }: Properties & { agency: AgencyFilter }) {
  const [assessmentId, setAssessmentId] = useState("");
  const [state, setState] = useState<LookupState>({ kind: "idle" });
  const [audits, setAudits] = useState<AuditState>({ kind: "idle" });

  async function lookup(): Promise<void> {
    const trimmed = assessmentId.trim();
    if (trimmed === "") {
      return;
    }
    setState({ kind: "loading" });
    setAudits({ kind: "idle" });
    try {
      const assessment = await fetchAssessment(configuration, token, trimmed);
      setState({ kind: "ready", assessment, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setState({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }

  async function loadAudits(id: string): Promise<void> {
    setAudits({ kind: "loading" });
    try {
      const result = await fetchExemptionAudits(configuration, token, id);
      setAudits({ kind: "ready", audits: result.audits, assessmentId: id, observedAt: new Date().toISOString() });
    } catch (error) {
      const classified = classifyRevenueError(error);
      setAudits({ kind: "error", error: classified });
      if (classified.kind === "unauthorized") {
        onUnauthorized();
      }
    }
  }

  return (
    <section className="receipt-lookup">
      <h3 className="revenue-subheading">Assessment drill-through</h3>
      <p className="queue-note">The tariff engine exposes assessments by id only — there is no list or search endpoint upstream. Enter a recorded assessment id; the lines render grouped by revenue line and every applied exemption links to its audit trail.</p>
      <div className="queue-controls revenue-controls">
        <label>
          Assessment id
          <input type="text" value={assessmentId} placeholder="Recorded assessment identifier" onChange={(event) => setAssessmentId(event.target.value)} />
        </label>
        <button className="button button--outline revenue-inline-button" disabled={assessmentId.trim() === ""} onClick={() => void lookup()}>Read assessment</button>
      </div>

      {state.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
      {state.kind === "error" && <PanelStateView state={state.error} onRetry={() => void lookup()} />}
      {state.kind === "ready" && (
        <AssessmentDetail assessment={state.assessment} observedAt={state.observedAt} agency={agency} audits={audits} onLoadAudits={loadAudits} />
      )}
    </section>
  );
}

function AssessmentDetail({ assessment, observedAt, agency, audits, onLoadAudits }: {
  assessment: Assessment;
  observedAt: string;
  agency: AgencyFilter;
  audits: AuditState;
  onLoadAudits: (assessmentId: string) => Promise<void>;
}) {
  const lines = filterLinesByAgency(assessment.lines, agency);
  const exemptLines = lines.filter((line) => line.applicability === "EXEMPT");
  return (
    <>
      <div className="detail-grid revenue-totals">
        <dt>Assessment</dt><dd className="detail-mono">{assessment.assessmentId}</dd>
        <dt>Assessed as of</dt><dd>{assessment.asOf}</dd>
        <dt>Total (USD)</dt><dd>{formatMinor(assessment.totalUsdMinor, "USD")}</dd>
        <dt>Total (NGN)</dt><dd>{formatMinor(assessment.totalNgnMinor, "NGN")}</dd>
        <dt>Requester</dt><dd className="detail-mono">{assessment.requester}</dd>
        <dt>Correlation id</dt><dd className="detail-mono">{assessment.correlationId}</dd>
        <dt>Recorded</dt><dd>{new Date(assessment.createdAt).toLocaleString()}</dd>
      </div>
      {lines.length === 0 ? (
        <p className="queue-note" role="status">No assessment lines match the current agency filter ({assessment.lines.length} line(s) observed across all agencies).</p>
      ) : (
        <table className="queue-table revenue-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Revenue line</th>
              <th scope="col">Agency</th>
              <th scope="col">Applicability</th>
              <th scope="col">Amount</th>
              <th scope="col">Basis</th>
              <th scope="col">Exemption</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNo}>
                <td>{line.lineNo}</td>
                <td>{line.instrument}{line.provisional === true ? " (provisional)" : ""}</td>
                <td>{line.agency}</td>
                <td><span className={`status-chip status-chip--${line.applicability.toLowerCase()}`}>{line.applicability}</span></td>
                <td>{line.applicability === "CHARGED" ? formatMinor(line.amountMinor, line.currency) : "—"}</td>
                <td>{line.basis}{line.statutoryReference !== undefined && line.statutoryReference !== "" ? ` (${line.statutoryReference})` : ""}</td>
                <td className="detail-mono">{line.exemptionId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ProvenanceNote provenance={assessmentProvenance(assessment.assessmentId)} observedAt={observedAt} />

      <div className="action-panel revenue-audit-panel">
        <h3>Exemption audit trail</h3>
        <p className="action-note">
          {exemptLines.length === 0
            ? "No EXEMPT lines in the current view. The audit trail is still readable for the recorded assessment."
            : `${exemptLines.length} EXEMPT line(s) in the current view (${[...new Set(exemptLines.map((line) => line.exemptionId ?? ""))].filter((id) => id !== "").join(", ") || "exemption ids not carried on the lines"}). Each applied exemption is a first-class record with a per-application audit trail.`}
        </p>
        {audits.kind === "idle" && (
          <button className="button button--outline revenue-inline-button" onClick={() => void onLoadAudits(assessment.assessmentId)}>Read exemption audits</button>
        )}
        {audits.kind === "loading" && <PanelStateView state={{ kind: "loading" }} />}
        {audits.kind === "error" && <PanelStateView state={audits.error} onRetry={() => void onLoadAudits(assessment.assessmentId)} />}
        {audits.kind === "ready" && audits.assessmentId === assessment.assessmentId && (
          audits.audits.length === 0 ? (
            <>
              <PanelStateView state={{ kind: "no-data", detail: "The exemption-audit endpoint returned zero audit records for this assessment." }} />
              <ProvenanceNote provenance={exemptionAuditsProvenance(assessment.assessmentId)} observedAt={audits.observedAt} />
            </>
          ) : (
            <>
              <table className="queue-table revenue-table">
                <thead>
                  <tr>
                    <th scope="col">Audit id</th>
                    <th scope="col">Exemption</th>
                    <th scope="col">Instrument</th>
                    <th scope="col">Match</th>
                    <th scope="col">Statutory basis</th>
                    <th scope="col">Evidence required</th>
                    <th scope="col">Requester</th>
                    <th scope="col">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.audits.map((audit) => (
                    <tr key={audit.AuditID}>
                      <td className="detail-mono">{audit.AuditID}</td>
                      <td className="detail-mono">{audit.ExemptionID}</td>
                      <td>{audit.Instrument}</td>
                      <td>{audit.MatchKind}: {audit.MatchValue}</td>
                      <td>{audit.StatutoryBasis}</td>
                      <td>{audit.EvidenceRequirement}</td>
                      <td className="detail-mono">{audit.Requester}</td>
                      <td>{new Date(audit.CreatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ProvenanceNote provenance={exemptionAuditsProvenance(assessment.assessmentId)} observedAt={audits.observedAt} />
            </>
          )
        )}
      </div>
    </>
  );
}
