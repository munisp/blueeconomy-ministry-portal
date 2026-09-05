import { useState, type FormEvent } from "react";
import { submitOnboardingRequest } from "./administration-client";
import { isAdministrationOnboardingConfigured, type AdministrationRuntimeConfiguration } from "./runtime-config";

interface Properties {
  configuration: AdministrationRuntimeConfiguration;
  token: string | null;
}

export function OnboardingPanel({ configuration, token }: Properties) {
  if (!isAdministrationOnboardingConfigured(configuration)) {
    return (
      <section className="onboarding-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Central administration</p>
            <h2>Administration onboarding is not configured for this deployment</h2>
          </div>
        </div>
        <p className="section-note">
          The deployment-provided administration settings still contain placeholder values, so no onboarding
          endpoint is contacted and no request can be submitted from this portal. Contact the platform
          operator to publish an approved onboarding API URL and organization identifier.
        </p>
      </section>
    );
  }
  return <ConfiguredOnboardingPanel configuration={configuration} token={token} />;
}

function ConfiguredOnboardingPanel({ configuration, token }: Properties) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  function toggleRole(role: string): void {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (token === null || roles.length === 0) {
      setOutcome(token === null ? "Sign in through the approved identity authority before submitting an onboarding request." : "Select at least one approved role.");
      return;
    }
    setInFlight(true);
    setOutcome(null);
    try {
      const result = await submitOnboardingRequest(configuration, token, {
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        requested_roles: roles,
      });
      setOutcome(`Recorded request ${result.id} with observed status ${result.status}. A distinct approver must decide it before any Keycloak invitation.`);
      setEmail("");
      setFirstName("");
      setLastName("");
      setRoles([]);
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : "onboarding request failed");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <section className="onboarding-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Central administration</p>
          <h2>Request stakeholder access</h2>
        </div>
        <p className="section-note">The request is recorded for independent approval. This portal does not create a local user, password or service account.</p>
      </div>
      <form className="onboarding-form" onSubmit={(event) => void submit(event)}>
        <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>First name<input required value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" /></label>
        <label>Last name<input required value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></label>
        <fieldset>
          <legend>Approved access roles</legend>
          <div className="role-selector">
            {configuration.allowed_roles.map((role) => (
              <label key={role} className="role-option"><input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />{role}</label>
            ))}
          </div>
        </fieldset>
        <div className="onboarding-actions">
          <button className="button" disabled={inFlight || token === null} type="submit">{inFlight ? "Submitting authorised request…" : "Submit for approval"}</button>
          {token === null && <span>Authentication required</span>}
        </div>
        {outcome !== null && <p className="onboarding-outcome" aria-live="polite">{outcome}</p>}
      </form>
    </section>
  );
}
