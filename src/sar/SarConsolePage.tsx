// SarConsolePage is the #/sar situation console: a live SAR case list with
// status/phase/region filters and a case detail view reconstructing the
// case state from the recorded event sequence (opened → phase/stage/tasking
// → SITREP → closed), including numbered SITREPs and cross-links to the
// Yaoundé regional incident-report releases recorded against the same
// incident. Every figure comes from the maritime-intelligence API; failures
// render honestly and no substitute data is ever shown.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SarConsoleEndpoints } from "../endpoint-config";
import { ErrorNotice, LoadingNotice, classifyServiceError } from "../api-state";
import {
  SarApiError,
  getCase,
  getTimeline,
  listCases,
  listSitreps,
  listTaskings,
  listYaoundeReleases,
} from "./sar-client";
import {
  SAR_PHASES,
  SAR_REGIONS,
  caseStatus,
  regionOfCase,
  type SarCase,
  type SarPhase,
  type SarSitrep,
  type SarTasking,
  type SarTimelineEntry,
  type YaoundeRelease,
} from "./sar-model";

// The console polls the case list on a bounded cadence so the situation
// view tracks the event stream without a websocket; manual refresh is
// always available.
const CASE_LIST_POLL_MS = 30_000;

export interface SarConsolePageProperties {
  endpoints: SarConsoleEndpoints;
  token: string;
  selectedCaseId: string | null;
  onOpenCase: (caseId: string) => void;
  onCloseCase: () => void;
  onUnauthorized: () => void;
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "loaded"; cases: SarCase[]; dropped: number; fetchedAt: string };

type StatusFilter = "all" | "open" | "closed";

export function SarConsolePage({ endpoints, token, selectedCaseId, onOpenCase, onCloseCase, onUnauthorized }: SarConsolePageProperties) {
  if (selectedCaseId !== null) {
    return <SarCaseDetail endpoints={endpoints} token={token} caseId={selectedCaseId} onBack={onCloseCase} onUnauthorized={onUnauthorized} />;
  }
  return <SarCaseList endpoints={endpoints} token={token} onOpenCase={onOpenCase} onUnauthorized={onUnauthorized} />;
}

function SarCaseList({ endpoints, token, onOpenCase, onUnauthorized }: Omit<SarConsolePageProperties, "selectedCaseId" | "onCloseCase" | "onOpenCase"> & { onOpenCase: (caseId: string) => void }) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<"" | SarPhase>("");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const load = useCallback(
    async (phase: "" | SarPhase) => {
      try {
        const result = await listCases(endpoints, token, phase === "" ? {} : { phase });
        setState({ kind: "loaded", cases: result.cases, dropped: result.dropped, fetchedAt: new Date().toISOString() });
      } catch (error) {
        setState({ kind: "error", error });
      }
    },
    [endpoints, token],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    void load(phaseFilter);
  }, [load, phaseFilter]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      // Silent background refresh: keep the current view on failure; the
      // next manual refresh surfaces any error explicitly.
      void listCases(endpoints, token, phaseFilter === "" ? {} : { phase: phaseFilter }).then(
        (result) => setState({ kind: "loaded", cases: result.cases, dropped: result.dropped, fetchedAt: new Date().toISOString() }),
        () => undefined,
      );
    }, CASE_LIST_POLL_MS);
    return () => globalThis.clearInterval(timer);
  }, [endpoints, token, phaseFilter]);

  const visible = useMemo(() => {
    if (state.kind !== "loaded") {
      return [];
    }
    return state.cases.filter((sarCase) => {
      if (statusFilter !== "all" && caseStatus(sarCase) !== statusFilter) {
        return false;
      }
      if (regionFilter !== "all" && regionOfCase(sarCase).id !== regionFilter) {
        return false;
      }
      return true;
    });
  }, [state, statusFilter, regionFilter]);

  if (state.kind === "loading") {
    return <LoadingNotice label="Loading the SAR case list" />;
  }
  if (state.kind === "error") {
    const classified = classifyServiceError(state.error, SarApiError, "maritime-intelligence service");
    if (classified.unauthorized) {
      onUnauthorized();
      return null;
    }
    return <ErrorNotice error={classified} onRetry={() => void load(phaseFilter)} />;
  }

  const openCount = state.cases.filter((sarCase) => caseStatus(sarCase) === "open").length;
  return (
    <section className="service-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SAR situation console</p>
          <h2>{openCount} open / {state.cases.length} recorded case{state.cases.length === 1 ? "" : "s"}</h2>
        </div>
        <p className="section-note">
          Observed from the maritime-intelligence SAR C2 API at {new Date(state.fetchedAt).toLocaleTimeString()}; records above the session clearance are excluded by the backend.
          {state.dropped > 0 ? ` ${state.dropped} record${state.dropped === 1 ? "" : "s"} failed contract validation and ${state.dropped === 1 ? "was" : "were"} not rendered.` : ""}
        </p>
      </div>

      <div className="filter-bar" role="group" aria-label="Case filters">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed (stand-down)</option>
          </select>
        </label>
        <label>
          IAMSAR phase
          <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as "" | SarPhase)}>
            <option value="">All phases</option>
            {SAR_PHASES.map((phase) => (
              <option key={phase} value={phase}>{phase}</option>
            ))}
          </select>
        </label>
        <label>
          Region (derived from recorded position)
          <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
            <option value="all">All regions</option>
            {SAR_REGIONS.map((region) => (
              <option key={region.id} value={region.id}>{region.label}</option>
            ))}
            <option value="outside-regions">Outside named regions</option>
            <option value="no-position">No recorded position</option>
          </select>
        </label>
        <button className="button button--outline filter-bar__refresh" onClick={() => void load(phaseFilter)}>Refresh</button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state" aria-live="polite">
          <p className="eyebrow">No cases match</p>
          <h2>No SAR cases under the current filters</h2>
          <p>The API returned {state.cases.length} case{state.cases.length === 1 ? "" : "s"} for this session; none match the selected status/phase/region combination. No substitute data is shown.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Status</th>
              <th>Phase</th>
              <th>Stage</th>
              <th>Intake</th>
              <th>Region (derived)</th>
              <th>Persons at risk</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((sarCase) => (
              <tr key={sarCase.case_id}>
                <td>
                  <button className="link-button" onClick={() => onOpenCase(sarCase.case_id)}>{sarCase.case_id}</button>
                  <div className="cell-sub">incident {sarCase.incident_id}</div>
                </td>
                <td><span className={`status-pill status-pill--${caseStatus(sarCase) === "open" ? "open" : "closed"}`}>{caseStatus(sarCase)}</span></td>
                <td>{sarCase.phase}</td>
                <td>{sarCase.stage}</td>
                <td>{sarCase.intake_kind}{sarCase.source_ref !== "" ? <div className="cell-sub">{sarCase.source_ref}</div> : null}</td>
                <td>{regionOfCase(sarCase).label}</td>
                <td>{sarCase.persons_at_risk ?? "—"}</td>
                <td>{new Date(sarCase.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | {
      kind: "loaded";
      sarCase: SarCase;
      timeline: SarTimelineEntry[];
      taskings: SarTasking[];
      sitreps: SarSitrep[];
      releases: YaoundeRelease[] | null;
      dropped: number;
    };

function SarCaseDetail({ endpoints, token, caseId, onBack, onUnauthorized }: { endpoints: SarConsoleEndpoints; token: string; caseId: string; onBack: () => void; onUnauthorized: () => void }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // The case, its append-only timeline, taskings and SITREPs are the
      // recorded event sequence; the Yaoundé release ledger is cross-linked
      // by incident reference. A release-ledger failure degrades only the
      // cross-link panel (rendered as its own honest error), never the case.
      const [sarCase, timeline, taskings, sitreps, releases] = await Promise.all([
        getCase(endpoints, token, caseId),
        getTimeline(endpoints, token, caseId),
        listTaskings(endpoints, token, caseId),
        listSitreps(endpoints, token, caseId),
        listYaoundeReleases(endpoints, token).then(
          (result) => result.releases,
          () => null,
        ),
      ]);
      setState({
        kind: "loaded",
        sarCase,
        timeline: timeline.entries,
        taskings: taskings.taskings,
        sitreps: sitreps.sitreps,
        releases: releases === null ? null : releases.filter((release) => release.incident_id === sarCase.incident_id),
        dropped: timeline.dropped + taskings.dropped + sitreps.dropped,
      });
    } catch (error) {
      setState({ kind: "error", error });
    }
  }, [endpoints, token, caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return <LoadingNotice label={`Loading SAR case ${caseId}`} />;
  }
  if (state.kind === "error") {
    const classified = classifyServiceError(state.error, SarApiError, "maritime-intelligence service");
    if (classified.unauthorized) {
      onUnauthorized();
      return null;
    }
    return <ErrorNotice error={classified} onRetry={() => void load()} />;
  }

  const { sarCase } = state;
  const orderedTimeline = [...state.timeline].sort((left, right) => left.created_at.localeCompare(right.created_at));
  const orderedSitreps = [...state.sitreps].sort((left, right) => left.sequence - right.sequence);
  return (
    <section className="service-section">
      <button className="button button--quiet" onClick={onBack}>← Back to the case list</button>
      <div className="section-heading">
        <div>
          <p className="eyebrow">SAR case {sarCase.case_id}</p>
          <h2>
            {sarCase.phase} · {sarCase.stage}{" "}
            <span className={`status-pill status-pill--${caseStatus(sarCase) === "open" ? "open" : "closed"}`}>{caseStatus(sarCase)}</span>
          </h2>
        </div>
        <p className="section-note">
          Incident {sarCase.incident_id} · intake {sarCase.intake_kind}{sarCase.source_ref !== "" ? ` (${sarCase.source_ref})` : ""} · classification {sarCase.classification} · version {sarCase.version}.
          {state.dropped > 0 ? ` ${state.dropped} timeline/tasking/SITREP record${state.dropped === 1 ? "" : "s"} failed contract validation and ${state.dropped === 1 ? "was" : "were"} not rendered.` : ""}
        </p>
      </div>

      <div className="detail-grid">
        <article className="panel">
          <h3>Recorded case state</h3>
          <dl className="fact-list">
            <div><dt>Opened by</dt><dd>{sarCase.created_by} at {new Date(sarCase.created_at).toLocaleString()}</dd></div>
            <div><dt>Persons at risk</dt><dd>{sarCase.persons_at_risk ?? "not recorded"}</dd></div>
            <div>
              <dt>Last known position</dt>
              <dd>
                {sarCase.last_known_lat !== null && sarCase.last_known_lon !== null
                  ? `${sarCase.last_known_lat.toFixed(5)}, ${sarCase.last_known_lon.toFixed(5)}${sarCase.last_known_at !== null ? ` at ${new Date(sarCase.last_known_at).toLocaleString()}` : ""}`
                  : "not recorded"}
              </dd>
            </div>
            <div>
              <dt>Datum</dt>
              <dd>
                {sarCase.datum_lat !== null && sarCase.datum_lon !== null
                  ? `${sarCase.datum_lat.toFixed(5)}, ${sarCase.datum_lon.toFixed(5)}${sarCase.datum_at !== null ? ` at ${new Date(sarCase.datum_at).toLocaleString()}` : ""} (evidence ${sarCase.datum_evidence_sha256 ?? "digest not recorded"})`
                  : "not recorded"}
              </dd>
            </div>
            {sarCase.stand_down_reason !== null && (
              <>
                <div><dt>Stand-down reason</dt><dd>{sarCase.stand_down_reason}</dd></div>
                <div><dt>Persons recovered</dt><dd>{sarCase.persons_recovered ?? "not recorded"}</dd></div>
                {sarCase.handover_ref !== null && <div><dt>Handover reference</dt><dd>{sarCase.handover_ref}</dd></div>}
              </>
            )}
          </dl>
        </article>

        <article className="panel">
          <h3>Yaoundé regional cross-links</h3>
          {state.releases === null ? (
            <p className="panel-note">The Yaoundé release ledger could not be read for this session (role or availability). Cross-links are omitted rather than substituted.</p>
          ) : state.releases.length === 0 ? (
            <p className="panel-note">No regional incident-report release is recorded against incident {sarCase.incident_id}.</p>
          ) : (
            <ul className="release-list">
              {state.releases.map((release) => (
                <li key={release.release_id}>
                  <strong>{release.release_id}</strong> → peer {release.peer_id}
                  <div className="cell-sub">
                    {release.state} · marking {release.marking} · classification {release.classification}
                    {release.dispatched_at !== null ? ` · dispatched ${new Date(release.dispatched_at).toLocaleString()}` : ""}
                    {release.acked_at !== null ? ` · acknowledged ${new Date(release.acked_at).toLocaleString()}` : ""}
                  </div>
                  <div className="cell-sub">report digest {release.report_sha256}</div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <article className="panel">
        <h3>Tasking orders</h3>
        {state.taskings.length === 0 ? (
          <p className="panel-note">No tasking order is recorded for this case.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Tasking</th><th>Resource</th><th>Task</th><th>State</th><th>Tasked by</th><th>Acked by</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {state.taskings.map((tasking) => (
                <tr key={tasking.tasking_id}>
                  <td>{tasking.tasking_id}</td>
                  <td>{tasking.resource_id}</td>
                  <td>{tasking.task}</td>
                  <td><span className={`status-pill status-pill--${tasking.state === "ABORTED" || tasking.state === "RELEASED" ? "closed" : "open"}`}>{tasking.state}</span></td>
                  <td>{tasking.tasked_by}</td>
                  <td>{tasking.acked_by ?? "—"}</td>
                  <td>{new Date(tasking.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      <article className="panel">
        <h3>SITREPs</h3>
        {orderedSitreps.length === 0 ? (
          <p className="panel-note">No SITREP has been issued for this case.</p>
        ) : (
          orderedSitreps.map((sitrep) => <SitrepCard key={sitrep.sitrep_id} sitrep={sitrep} />)
        )}
      </article>

      <article className="panel">
        <h3>Case timeline (recorded event sequence)</h3>
        {orderedTimeline.length === 0 ? (
          <p className="panel-note">The backend recorded no timeline entries for this case.</p>
        ) : (
          <ol className="timeline">
            {orderedTimeline.map((entry) => (
              <li key={entry.entry_id}>
                <div className="timeline__header">
                  <span className={`timeline__type timeline__type--${timelineKind(entry)}`}>{entry.entry_type}</span>
                  <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
                </div>
                {entry.actor !== "" && <div className="cell-sub">recorded by {entry.actor}</div>}
                {Object.keys(entry.detail).length > 0 && (
                  <dl className="fact-list fact-list--compact">
                    {Object.entries(entry.detail).map(([key, value]) => (
                      <div key={key}><dt>{key}</dt><dd>{renderDetailValue(value)}</dd></div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        )}
      </article>
    </section>
  );
}

// timelineKind groups entry types for presentation along the documented
// lifecycle: opened → phase/stage/tasking → sitrep → closed.
function timelineKind(entry: SarTimelineEntry): "open" | "transition" | "sitrep" | "close" | "other" {
  if (entry.entry_type === "case.opened" || entry.entry_type === "case.intake_linked") {
    return "open";
  }
  if (entry.entry_type === "sitrep.issued") {
    return "sitrep";
  }
  if (entry.entry_type === "stage.changed" && entry.detail.stage === "STAND_DOWN") {
    return "close";
  }
  if (entry.entry_type === "phase.changed" || entry.entry_type === "stage.changed" || entry.entry_type.startsWith("tasking.") || entry.entry_type === "datum.set") {
    return "transition";
  }
  if (entry.entry_type === "sos.resolved") {
    return "close";
  }
  return "other";
}

function renderDetailValue(value: unknown): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// SitrepCard renders one numbered, immutable SITREP exactly as retained:
// the body assembled from recorded case state, its digest and issuer.
function SitrepCard({ sitrep }: { sitrep: SarSitrep }) {
  return (
    <section className="sitrep-card" aria-label={`SITREP ${sitrep.sequence}`}>
      <div className="sitrep-card__header">
        <strong>SITREP #{sitrep.sequence}</strong>
        <span className="cell-sub">issued by {sitrep.issued_by} at {new Date(sitrep.issued_at).toLocaleString()}</span>
      </div>
      {Object.keys(sitrep.body).length === 0 ? (
        <p className="panel-note">The issued SITREP body is retained under digest {sitrep.body_sha256}; no inline body fields were served.</p>
      ) : (
        <dl className="fact-list">
          {Object.entries(sitrep.body).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{renderDetailValue(value)}</dd></div>
          ))}
        </dl>
      )}
      <p className="cell-sub">body digest {sitrep.body_sha256} · signed artefact retained by the producing boundary</p>
    </section>
  );
}
