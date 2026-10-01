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
      <form className="onboarding-form" onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}>
        <label>
          Onboarding request ID
          <input required value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="UUID returned by the onboarding submission" />
        </label>
        <fieldset>
          <legend>Decide (POST /v1/onboarding/requests/{