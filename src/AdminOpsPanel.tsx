import { useState, type FormEvent } from "react";
import {
  activateOnboardingRequest,
  attestPrivacyActivity,
  createPrivacyActivity,
  decideOnboardingRequest,
  decidePrivacyActivity,
  getPrivacyActivity,
  provisionOnboardingRequest,
  resolveAdministrationApiRoot,
  submitPrivacyDpoReview,
  type PrivacyProcessingActivity,
} from "./admin-ops-client";
import { isAdministrationOnboardingConfigured, type AdministrationRuntimeConfiguration } from "./runtime-config";

interface Properties {
  configuration: AdministrationRuntimeConfiguration;
  token: string | null;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function splitReferences(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AdminOpsPanel({ configuration, token }: Properties) {
  const apiRoot = resolveAdministrationApiRoot(configuration);
  if (!isAdministrationOnboardingConfigured(configuration) || apiRoot === null) {
    return (
      <section className="onboarding-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Administration operations</p>
            <h2>Administration operations are not configured for this deployment</h2>
          </div>
        </div>
        <p className="section-note">
          The deployment-provided administration settings do not expose a usable administration-service API
          root, so no decision, provisioning, activation or privacy workflow endpoint is contacted from this
          portal. Contact the platform operator to publish an approved onboarding API URL.
        </p>
      </section>
    );
  }
  if (token === null) {
    return (
      <section className="onboarding-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Administration operations</p>
            <h2>Sign in to operate administration workflows</h2>
          </div>
        </div>
        <p className="section-note">
          Decision, provisioning, activation and privacy workflow actions require an authenticated session
          through the approved identity authority. Backend role checks (approver role, maker/checker) remain
          authoritative and their error codes are surfaced verbatim.
        </p>
      </section>
    );
  }
  return (
    <>
      <OnboardingOpsPanel apiRoot={apiRoot} token={token} />
      <PrivacyOpsPanel apiRoot={apiRoot} token={token} />
    </>
  );
}

interface PanelProperties {
  apiRoot: string;
  token: string;
}

function OnboardingOpsPanel({ apiRoot, token }: PanelProperties) {
  const [requestId, setRequestId] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [keycloakUserId, setKeycloakUserId] = useState("");
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function run(operation: string, action: () => Promise<{ id?: string; status?: string } | void>): Promise<void> {
    if (requestId.trim().length === 0) {
      setOutcome("Enter an onboarding request ID first.");
      return;
    }
    setInFlight(operation);
    setOutcome(null);
    try {
      const result = await action();
      if (result !== undefined && typeof result.id === "string") {
        setOutcome(`${operation} recorded for request ${result.id} with observed status ${result.status ?? "unknown"}.`);
      } else {
        setOutcome(`${operation} completed for request ${requestId.trim()} (HTTP 204, no response body).`);
      }
    } catch (error) {
      setOutcome(errorMessage(error, `${operation} failed`));
    } finally {
      setInFlight(null);
    }
  }

  return (
    <section className="onboarding-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Administration operations</p>
          <h2>Onboarding request operations</h2>
        </div>
        <p className="section-note">
          Approver-role endpoints. The backend enforces maker/checker and role gates; its HTTP status and
          error text are shown unchanged.
        </p>
      </div>
      <div className="onboarding-form">
        <label>
          Onboarding request ID
          <input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="UUID returned by the onboarding submission" />
        </label>
        <fieldset>
          <legend>Decision</legend>
          <div className="role-selector">
            <label className="role-option">
              <input type="radio" name="onboarding-decision" checked={decision === "approve"} onChange={() => setDecision("approve")} />
              approve
            </label>
            <label className="role-option">
              <input type="radio" name="onboarding-decision" checked={decision === "reject"} onChange={() => setDecision("reject")} />
              reject
            </label>
          </div>
          <label>
            Reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Recorded decision reason" />
          </label>
        </fieldset>
        <label>
          Keycloak user ID (activation only)
          <input value={keycloakUserId} onChange={(event) => setKeycloakUserId(event.target.value)} placeholder="Required for Activate" />
        </label>
        <div className="onboarding-actions">
          <button
            className="button"
            disabled={inFlight !== null}
            onClick={() => void run("Decision", () => decideOnboardingRequest(apiRoot, token, requestId.trim(), decision, reason.trim()))}
          >
            {inFlight === "Decision" ? "Recording decision…" : "Decide"}
          </button>
          <button
            className="button button--outline"
            disabled={inFlight !== null}
            onClick={() => void run("Provisioning", () => provisionOnboardingRequest(apiRoot, token, requestId.trim()))}
          >
            {inFlight === "Provisioning" ? "Inviting via Keycloak…" : "Provision"}
          </button>
          <button
            className="button button--outline"
            disabled={inFlight !== null || keycloakUserId.trim().length === 0}
            onClick={() => void run("Activation", () => activateOnboardingRequest(apiRoot, token, requestId.trim(), keycloakUserId.trim()))}
          >
            {inFlight === "Activation" ? "Assigning roles…" : "Activate"}
          </button>
        </div>
        {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
      </div>
    </section>
  );
}

function PrivacyOpsPanel({ apiRoot, token }: PanelProperties) {
  const [activityKey, setActivityKey] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [classifications, setClassifications] = useState("");
  const [recipients, setRecipients] = useState("");
  const [evidenceSha, setEvidenceSha] = useState("");
  const [ownerSubject, setOwnerSubject] = useState("");

  const [lookupId, setLookupId] = useState("");
  const [activity, setActivity] = useState<PrivacyProcessingActivity | null>(null);

  const [workflowReason, setWorkflowReason] = useState("");
  const [workflowEvidence, setWorkflowEvidence] = useState("");
  const [privacyDecision, setPrivacyDecision] = useState<"conditionally_approved" | "approved" | "rejected">("approved");
  const [expiresAt, setExpiresAt] = useState("");

  const [inFlight, setInFlight] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function run(operation: string, action: () => Promise<PrivacyProcessingActivity>): Promise<void> {
    setInFlight(operation);
    setOutcome(null);
    try {
      const result = await action();
      setActivity(result);
      setLookupId(result.id);
      setOutcome(`${operation} recorded. Activity ${result.id} now has status ${result.status} at version ${result.version}.`);
    } catch (error) {
      setOutcome(errorMessage(error, `${operation} failed`));
    } finally {
      setInFlight(null);
    }
  }

  function workflowInput() {
    if (activity === null) {
      throw new Error("Load or create an activity first so expected_version is known.");
    }
    if (!SHA256_PATTERN.test(workflowEvidence.trim())) {
      throw new Error("evidence_sha256 must be a canonical sha256 digest (sha256: + 64 lowercase hex).");
    }
    return { expected_version: activity.version, reason: workflowReason.trim(), evidence_sha256: workflowEvidence.trim() };
  }

  async function lookup(): Promise<void> {
    if (lookupId.trim().length === 0) {
      setOutcome("Enter a privacy activity ID to look up.");
      return;
    }
    setInFlight("Lookup");
    setOutcome(null);
    try {
      const result = await getPrivacyActivity(apiRoot, token, lookupId.trim());
      setActivity(result);
      setOutcome(`Observed activity ${result.id}: status ${result.status}, version ${result.version}.`);
    } catch (error) {
      setActivity(null);
      setOutcome(errorMessage(error, "privacy activity lookup failed"));
    } finally {
      setInFlight(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!SHA256_PATTERN.test(evidenceSha.trim())) {
      setOutcome("evidence_sha256 must be a canonical sha256 digest (sha256: + 64 lowercase hex).");
      return;
    }
    await run("Creation", () => createPrivacyActivity(apiRoot, token, {
      activity_key: activityKey.trim(),
      service_name: serviceName.trim(),
      purpose: purpose.trim(),
      data_classifications: splitReferences(classifications),
      external_recipients: splitReferences(recipients),
      evidence_sha256: evidenceSha.trim(),
      owner_subject: ownerSubject.trim(),
    }));
  }

  return (
    <section className="onboarding-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Administration operations</p>
          <h2>Privacy (NDPA) processing activities</h2>
        </div>
        <p className="section-note">
          Register processing activities and drive the owner attestation, DPO review and decision workflow.
          Optimistic-concurrency expected_version is taken from the last loaded/created activity.
        </p>
      </div>
      <form className="onboarding-form" onSubmit={(event) => void create(event)}>
        <fieldset>
          <legend>Create activity</legend>
          <label>Activity key<input required value={activityKey} onChange={(event) => setActivityKey(event.target.value)} placeholder="lowercase-canonical-key" /></label>
          <label>Service name<input required value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></label>
          <label>Purpose<textarea required maxLength={2048} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
          <label>Data classifications (comma-separated)<input required value={classifications} onChange={(event) => setClassifications(event.target.value)} placeholder="personal_data, contact_data" /></label>
          <label>External recipients (comma-separated, optional)<input value={recipients} onChange={(event) => setRecipients(event.target.value)} /></label>
          <label>Evidence SHA-256<input required value={evidenceSha} onChange={(event) => setEvidenceSha(event.target.value)} placeholder="sha256:<64 lowercase hex>" /></label>
          <label>Owner subject<input required value={ownerSubject} onChange={(event) => setOwnerSubject(event.target.value)} placeholder="Identity subject of the accountable owner" /></label>
          <div className="onboarding-actions">
            <button className="button" disabled={inFlight !== null} type="submit">{inFlight === "Creation" ? "Recording activity…" : "Create activity"}</button>
          </div>
        </fieldset>
      </form>
      <div className="onboarding-form">
        <fieldset>
          <legend>Load activity</legend>
          <label>Activity ID<input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="UUID" /></label>
          <div className="onboarding-actions">
            <button className="button button--outline" disabled={inFlight !== null} onClick={() => void lookup()}>
              {inFlight === "Lookup" ? "Loading…" : "View activity"}
            </button>
          </div>
        </fieldset>
        {activity !== null && (
          <dl className="probe-evidence">
            <dt>Status</dt><dd>{activity.status} (version {activity.version})</dd>
            <dt>Activity key</dt><dd>{activity.activity_key}</dd>
            <dt>Service</dt><dd>{activity.service_name}</dd>
            <dt>Owner subject</dt><dd>{activity.owner_subject}</dd>
            <dt>Requester subject</dt><dd>{activity.requester_subject}</dd>
            <dt>Data classifications</dt><dd>{activity.data_classifications.join(", ")}</dd>
            <dt>External recipients</dt><dd>{activity.external_recipients.length > 0 ? activity.external_recipients.join(", ") : "none"}</dd>
            {activity.approval_conditions.length > 0 && <><dt>Approval conditions</dt><dd>{activity.approval_conditions}</dd></>}
            {activity.approval_expires_at !== undefined && <><dt>Approval expires</dt><dd>{activity.approval_expires_at}</dd></>}
            <dt>Updated</dt><dd>{activity.updated_at}</dd>
          </dl>
        )}
        <fieldset>
          <legend>Workflow actions (attest / submit DPO review / decision)</legend>
          <label>Reason<input value={workflowReason} onChange={(event) => setWorkflowReason(event.target.value)} /></label>
          <label>Evidence SHA-256<input value={workflowEvidence} onChange={(event) => setWorkflowEvidence(event.target.value)} placeholder="sha256:<64 lowercase hex>" /></label>
          <div className="onboarding-actions">
            <button
              className="button button--outline"
              disabled={inFlight !== null || activity === null}
              onClick={() => {
                try {
                  const input = workflowInput();
                  void run("Attestation", () => attestPrivacyActivity(apiRoot, token, activity!.id, input));
                } catch (error) {
                  setOutcome(errorMessage(error, "attestation failed"));
                }
              }}
            >
              {inFlight === "Attestation" ? "Attesting…" : "Attest"}
            </button>
            <button
              className="button button--outline"
              disabled={inFlight !== null || activity === null}
              onClick={() => {
                try {
                  const input = workflowInput();
                  void run("DPO-review submission", () => submitPrivacyDpoReview(apiRoot, token, activity!.id, input));
                } catch (error) {
                  setOutcome(errorMessage(error, "DPO-review submission failed"));
                }
              }}
            >
              {inFlight === "DPO-review submission" ? "Submitting…" : "Submit for DPO review"}
            </button>
          </div>
          <div className="role-selector">
            {(["approved", "conditionally_approved", "rejected"] as const).map((candidate) => (
              <label key={candidate} className="role-option">
                <input type="radio" name="privacy-decision" checked={privacyDecision === candidate} onChange={() => setPrivacyDecision(candidate)} />
                {candidate}
              </label>
            ))}
          </div>
          {privacyDecision === "conditionally_approved" && (
            <label>
              Approval expires at (required, within 180 days)
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </label>
          )}
          <div className="onboarding-actions">
            <button
              className="button"
              disabled={inFlight !== null || activity === null}
              onClick={() => {
                try {
                  const input = workflowInput();
                  if (privacyDecision === "conditionally_approved" && expiresAt.length === 0) {
                    throw new Error("conditional approval requires an expiry time");
                  }
                  void run("Privacy decision", () => decidePrivacyActivity(apiRoot, token, activity!.id, {
                    ...input,
                    decision: privacyDecision,
                    ...(privacyDecision === "conditionally_approved" ? { approval_expires_at: new Date(expiresAt).toISOString() } : {}),
                  }));
                } catch (error) {
                  setOutcome(errorMessage(error, "privacy decision failed"));
                }
              }}
            >
              {inFlight === "Privacy decision" ? "Recording decision…" : "Record DPO decision"}
            </button>
          </div>
        </fieldset>
        {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
      </div>
    </section>
  );
}
