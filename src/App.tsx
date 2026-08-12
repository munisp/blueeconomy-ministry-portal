import { useEffect, useMemo, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { accessToken, completeAuthenticationCallback, createUserManager } from "./auth";
import { loadRuntimeConfiguration, type PortalRuntimeConfiguration, type ServiceRuntimeConfiguration } from "./runtime-config";
import { probeService, type ServiceProbeResult } from "./service-client";

const RUNTIME_CONFIGURATION_URL = "/platform-config.json";

type ApplicationState =
  | { kind: "loading" }
  | { kind: "configuration-error"; error: string }
  | { kind: "ready"; configuration: PortalRuntimeConfiguration; manager: UserManager; user: User | null };

export default function App() {
  const [state, setState] = useState<ApplicationState>({ kind: "loading" });
  const [probeResults, setProbeResults] = useState<Record<string, ServiceProbeResult>>({});
  const [probeInFlight, setProbeInFlight] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void bootstrap().then(
      (ready) => {
        if (active) {
          setState(ready);
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ kind: "configuration-error", error: error instanceof Error ? error.message : "portal bootstrap failed" });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const token = state.kind === "ready" ? accessToken(state.user) : null;
  const title = state.kind === "ready" ? state.configuration.application_name : "Blue Economy Platform";
  const authenticated = token !== null;

  async function startSignIn(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    await state.manager.signinRedirect();
  }

  async function startSignOut(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    await state.manager.signoutRedirect();
  }

  async function runProbe(service: ServiceRuntimeConfiguration): Promise<void> {
    if (token === null) {
      return;
    }
    setProbeInFlight(service.id);
    const result = await probeService(service, token);
    setProbeResults((current) => ({ ...current, [service.id]: result }));
    setProbeInFlight(null);
  }

  return (
    <main className="portal-shell">
      <header className="masthead">
        <div className="brand-block">
          <p className="eyebrow">Federal Ministry Marine and Blue Economy</p>
          <h1>{title}</h1>
          <p className="brand-description">A controlled entry point for authorised, interoperable Blue Economy services.</p>
        </div>
        <div className="session-panel" aria-live="polite">
          <span className={`status-dot ${authenticated ? "status-dot--success" : "status-dot--neutral"}`} />
          <span>{authenticated ? "Authenticated session" : "Authentication required"}</span>
          {state.kind === "ready" && (
            authenticated ? <button className="button button--quiet" onClick={() => void startSignOut()}>Sign out</button> : <button className="button" onClick={() => void startSignIn()}>Sign in</button>
          )}
        </div>
      </header>

      <section className="assurance-banner">
        <span className="assurance-mark">Controlled access</span>
        <p>Service status is shown only after a live, authorised probe. This portal does not generate records, users, transactions or operational metrics.</p>
      </section>

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "configuration-error" && <ConfigurationError error={state.error} />}
      {state.kind === "ready" && (
        <ServiceDirectory
          services={state.configuration.services}
          authenticated={authenticated}
          probes={probeResults}
          probeInFlight={probeInFlight}
          onProbe={runProbe}
        />
      )}
    </main>
  );
}

async function bootstrap(): Promise<Extract<ApplicationState, { kind: "ready" }>> {
  const configuration = await loadRuntimeConfiguration(RUNTIME_CONFIGURATION_URL);
  const manager = createUserManager(configuration.oidc);
  const callbackUser = await completeAuthenticationCallback(manager);
  const user = callbackUser ?? await manager.getUser();
  return { kind: "ready", configuration, manager, user };
}

function LoadingState() {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Secure bootstrap</p>
      <h2>Loading the approved environment configuration</h2>
      <p>The portal is waiting for the deployment-provided OIDC and service registry.</p>
    </section>
  );
}

function ConfigurationError({ error }: { error: string }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Integration gate active</p>
      <h2>Approved environment configuration is required</h2>
      <p>The portal did not load a valid runtime configuration. No substitute endpoint or local session has been created.</p>
      <pre>{error}</pre>
    </section>
  );
}

interface ServiceDirectoryProperties {
  services: ServiceRuntimeConfiguration[];
  authenticated: boolean;
  probes: Record<string, ServiceProbeResult>;
  probeInFlight: string | null;
  onProbe: (service: ServiceRuntimeConfiguration) => Promise<void>;
}

function ServiceDirectory({ services, authenticated, probes, probeInFlight, onProbe }: ServiceDirectoryProperties) {
  const serviceCount = useMemo(() => services.length, [services.length]);
  return (
    <section className="service-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Authorised services</p>
          <h2>{serviceCount} deployment-defined integration{serviceCount === 1 ? "" : "s"}</h2>
        </div>
        <p className="section-note">Backend authorisation remains authoritative. Required roles are shown for operational transparency.</p>
      </div>
      <div className="service-grid">
        {services.map((service) => {
          const result = probes[service.id];
          const waiting = probeInFlight === service.id;
          return (
            <article className="service-tile" key={service.id}>
              <div className="service-tile__header">
                <p className="service-id">{service.id}</p>
                <ProbeStatus result={result} />
              </div>
              <h3>{service.label}</h3>
              <div className="role-list" aria-label="Required roles">
                {service.required_roles.map((role) => <span key={role}>{role}</span>)}
              </div>
              <button className="button button--outline" disabled={!authenticated || waiting} onClick={() => void onProbe(service)}>
                {waiting ? "Probing authorised endpoint…" : authenticated ? "Probe authorised endpoint" : "Sign in to probe"}
              </button>
              {result !== undefined && <ProbeEvidence result={result} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProbeStatus({ result }: { result: ServiceProbeResult | undefined }) {
  if (result === undefined) {
    return <span className="probe-status probe-status--neutral">Not yet probed</span>;
  }
  return <span className={`probe-status ${result.ok ? "probe-status--success" : "probe-status--failure"}`}>{result.ok ? "Observed available" : "Observed unavailable"}</span>;
}

function ProbeEvidence({ result }: { result: ServiceProbeResult }) {
  return (
    <p className="probe-evidence">
      Observed at {new Date(result.completed_at).toLocaleString()}.
      {result.http_status !== undefined ? ` HTTP ${result.http_status}.` : ""}
      {result.failure !== undefined ? ` ${result.failure}` : ""}
    </p>
  );
}
