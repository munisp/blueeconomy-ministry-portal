import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  activateOnboardingRequest,
  findOnboardingRequest,
  provisionOnboardingRequest,
  submitOnboardingDecision,
  type OnboardingDecision,
  type OnboardingRequestRecord,
} from "./administration-client";
import { classifyError, ErrorNotice, LoadingNotice, type ClassifiedError } from "./api-state";
import { availableActions, statusGuidance, validateDecisionForm } from "./approvals-model";
import type { AdministrationRuntimeConfiguration } from "./runtime-config";

interface Properties {
  configuration: AdministrationRuntimeConfiguration;
  token: string;
  requestId: string;
  onUnauthorized: () => void;
  onBack: () => void;
}

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; error: ClassifiedError }
  | { kind: "not-found" }
  | { kind: "ready"; record: OnboardingRequestRecord };

// ApprovalDetailPage renders one queue record with the truthful action set
// for its recorded status: decision form (submitted/identity_verified),
// provision (approved) or activate (invited). Every action calls the real
// administration-service verb and the record is re-read from the API after
// each transition.
export function ApprovalDetailPage({ configuration, token, requestId, onUnauthorized, onBack }: Properties) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const record = await findOnboardingRequest(configuration, token, requestId);
      setState(record === null ? { kind: "not-found" } : { kind: "ready", record });
    } catch (error) {
      const classified = classifyError(error);
      setState({ kind: "error", error: classified });
      if (classified.unauthorized) {
        onUnauthorized();
      }
    }
  }, [configuration, token, requestId, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleActionError(error: unknown): void {
    const classified = classifyError(error);
    if (classified.unauthorized) {
      onUnauthorized();
    }
  }

  return (
    <section className="detail-section">
      <button className="button button--quiet" onClick={onBack}>← Back to the queue</button>
      {state.kind === "loading" && <LoadingNotice label="Loading the onboarding request" />}
      {state.kind === "error" && <ErrorNotice error={state.error} onRetry={() => void load()} />}
      {state.kind === "not-found" && (
        <section className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Not visible</p>
          <h2>Request {requestId} is not in your tenant queue</h2>
          <p>The administration API returned no record with this id inside your tenant scope. It does not exist, or it belongs to another tenant — the two are indistinguishable by design.</p>
        </section>
      )}
      {state.kind === "ready" && (
        <RequestDetail
          configuration={configuration}
          token={token}
          record={state.record}
          onRecordUpdated={(record) => setState({ kind: "ready", record })}
          onTransitionComplete={() => void load()}
          onActionError={handleActionError}
        />
      )}
    </section>
  );
}

interface RequestDetailProperties {
  configuration: AdministrationRuntimeConfiguration;
  token: string;
  record: OnboardingRequestRecord;
  onRecordUpdated: (record: OnboardingRequestRecord) => void;
  onTransitionComplete: () => void;
  onActionError: (error: unknown) => void;
}

function RequestDetail({ configuration, token, record, onRecordUpdated, onTransitionComplete, onActionError }: RequestDetailProperties) {
  const actions = availableActions(record.status);
  const guidance = statusGuidance(record);
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Onboarding request</p>
          <h2>{record.first_name} {record.last_name}</h2>
        </div>
        <span className={`status-chip status-chip--${record.status}`}>{record.status}</span>
      </div>

      <dl className="detail-grid">
        <div><dt>Request id</dt><dd className="detail-mono">{record.id}</dd></div>
        <div><dt>Organization / agency</dt><dd>{record.organization_id}</dd></div>
        <div><dt>Email</dt><dd>{record.email === "" ? "—" : record.email}</dd></div>
        <div><dt>Requested roles</dt><dd>{record.requested_roles.length === 0 ? "—" : record.requested_roles.join(", ")}</dd></div>
        <div><dt>Requester subject</dt><dd className="detail-mono">{record.requester_subject}</dd></div>
        {record.persona !== undefined && record.persona !== "" && <div><dt>Persona</dt><dd>{record.persona}</dd></div>}
        {record.contact_channel !== undefined && record.contact_channel !== "" && (
          <div><dt>Contact channel</dt><dd>{record.contact_channel}: {record.contact_reference ?? ""}</dd></div>
        )}
        {record.notification_status !== undefined && record.notification_status !== "" && (
          <div><dt>Notification status</dt><dd>{record.notification_status}</dd></div>
        )}
        <div><dt>Submitted at</dt><dd>{new Date(record.created_at).toLocaleString()}</dd></div>
        <div><dt>Last updated</dt><dd>{new Date(record.updated_at).toLocaleString()}</dd></div>
      </dl>

      {guidance !== null && <p className="queue-note" role="status">{guidance}</p>}

      {actions.includes("decide") && (
        <DecisionForm
          configuration={configuration}
          token={token}
          requestId={record.id}
          onDecided={onRecordUpdated}
          onActionError={onActionError}
        />
      )}
      {actions.includes("provision") && (
        <ProvisionAction
          configuration={configuration}
          token={token}
          requestId={record.id}
          onProvisioned={onTransitionComplete}
          onActionError={onActionError}
        />
      )}
      {actions.includes("activate") && (
        <ActivateAction
          configuration={configuration}
          token={token}
          requestId={record.id}
          onActivated={onTransitionComplete}
          onActionError={onActionError}
        />
      )}
    </>
  );
}

interface ActionProperties {
  configuration: AdministrationRuntimeConfiguration;
  token: string;
  requestId: string;
  onActionError: (error: unknown) => void;
}

function DecisionForm({ configuration, token, requestId, onDecided, onActionError }: ActionProperties & { onDecided: (record: OnboardingRequestRecord) => void }) {
  const [decision, setDecision] = useState<OnboardingDecision | "">("");
  const [reason, setReason] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const errors = validateDecisionForm({ decision, reason });
    setValidationErrors(errors);
    if (errors.length > 0 || decision === "") {
      return;
    }
    setInFlight(true);
    setOutcome(null);
    try {
      const updated = await submitOnboardingDecision(configuration, token, requestId, decision, reason.trim());
      onDecided(updated);
      setOutcome(`Decision recorded by the administration API. Observed status: ${updated.status}.`);
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : "decision submission failed");
      onActionError(error);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <form className="action-panel" onSubmit={(event) => void submit(event)}>
      <h3>Record the approver decision</h3>
      <p className="action-note">Maker/checker is enforced by the backend: you cannot decide a request you submitted yourself.</p>
      <fieldset>
        <legend>Decision</legend>
        <div className="role-selector">
          <label className="role-option"><input type="radio" name="decision" checked={decision === "approve"} onChange={() => setDecision("approve")} />Approve</label>
          <label className="role-option"><input type="radio" name="decision" checked={decision === "reject"} onChange={() => setDecision("reject")} />Reject</label>
        </div>
      </fieldset>
      <label className="action-field">
        Reason {decision === "reject" ? "(required for a rejection)" : "(optional)"}
        <textarea value={reason} rows={3} maxLength={1024} onChange={(event) => setReason(event.target.value)} />
      </label>
      {validationErrors.length > 0 && (
        <ul className="validation-errors" role="alert">
          {validationErrors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="onboarding-actions">
        <button className="button" type="submit" disabled={inFlight}>{inFlight ? "Recording decision…" : "Submit decision"}</button>
      </div>
      {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
    </form>
  );
}

function ProvisionAction({ configuration, token, requestId, onProvisioned, onActionError }: ActionProperties & { onProvisioned: () => void }) {
  const [inFlight, setInFlight] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function provision(): Promise<void> {
    setInFlight(true);
    setOutcome(null);
    try {
      await provisionOnboardingRequest(configuration, token, requestId);
      onProvisioned();
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : "provisioning failed");
      onActionError(error);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div className="action-panel">
      <h3>Provision the approved request</h3>
      <p className="action-note">This claims the request and sends the Keycloak organization invitation through the administration API. A Keycloak failure is reported truthfully, never hidden.</p>
      <button className="button" disabled={inFlight} onClick={() => void provision()}>{inFlight ? "Provisioning via Keycloak…" : "Provision (send invitation)"}</button>
      {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
    </div>
  );
}

function ActivateAction({ configuration, token, requestId, onActivated, onActionError }: ActionProperties & { onActivated: () => void }) {
  const [keycloakUserId, setKeycloakUserId] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function activate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setInFlight(true);
    setOutcome(null);
    try {
      await activateOnboardingRequest(configuration, token, requestId, keycloakUserId.trim());
      onActivated();
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : "activation failed");
      onActionError(error);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <form className="action-panel" onSubmit={(event) => void activate(event)}>
      <h3>Activate the invited user</h3>
      <p className="action-note">After the stakeholder registers through the invitation, record their Keycloak user id to assign the approved organization role groups.</p>
      <label className="action-field">
        Keycloak user id
        <input required value={keycloakUserId} maxLength={512} onChange={(event) => setKeycloakUserId(event.target.value)} />
      </label>
      <button className="button" type="submit" disabled={inFlight || keycloakUserId.trim() === ""}>{inFlight ? "Activating…" : "Activate"}</button>
      {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
    </form>
  );
}
