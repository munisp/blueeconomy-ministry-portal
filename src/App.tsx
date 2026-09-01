import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { accessToken, completeAuthenticationCallback, createUserManager } from "./auth";
import { OnboardingPanel } from "./OnboardingPanel";
import { loadRuntimeConfiguration, type PortalRuntimeConfiguration, type ServiceRuntimeConfiguration } from "./runtime-config";
import { probeService, type ServiceProbeResult } from "./service-client";
import { resolveDashboardApiBase } from "./api-client";
import { DASHBOARD_ROLES, extractRoles, hasAnyRole } from "./roles";
import { InstallPrompt } from "./InstallPrompt";
import { ExecutiveDashboardPage } from "./pages/ExecutiveDashboardPage";
import { OperationalKpisPage } from "./pages/OperationalKpisPage";
import { TradeAnalyticsPage } from "./pages/TradeAnalyticsPage";
import { RiskModelPage } from "./pages/RiskModelPage";
import { SlaBreachPage } from "./pages/SlaBreachPage";
import { CustomsNrsPage } from "./pages/CustomsNrsPage";
import { MinisterialKpiPackPage } from "./pages/MinisterialKpiPackPage";
import { WeeklyBriefingPage } from "./pages/WeeklyBriefingPage";
import type { DashboardPageProps } from "./pages/props";

const RUNTIME_CONFIGURATION_URL = "/platform-config.json";

type ApplicationState =
  | { kind: "loading" }
  | { kind: "configuration-error"; error: string }
  | { kind: "ready"; configuration: PortalRuntimeConfiguration; manager: UserManager; user: User | null };

interface NavigationItem {
  path: string;
  label: string;
  requiresDashboardRole: boolean;
  render: (properties: DashboardPageProps) => ReactElement;
}

const NAVIGATION: NavigationItem[] = [
  { path: "administration", label: "Administration", requiresDashboardRole: false, render: () => <></> },
  { path: "kpi-pack", label: "Ministerial KPI pack", requiresDashboardRole: true, render: (p) => <MinisterialKpiPackPage {...p} /> },
  { path: "executive", label: "Executive", requiresDashboardRole: true, render: (p) => <ExecutiveDashboardPage {...p} /> },
  { path: "operational", label: "Operational KPIs", requiresDashboardRole: true, render: (p) => <OperationalKpisPage {...p} /> },
  { path: "trade", label: "Trade analytics", requiresDashboardRole: true, render: (p) => <TradeAnalyticsPage {...p} /> },
  { path: "risk", label: "Risk model", requiresDashboardRole: true, render: (p) => <RiskModelPage {...p} /> },
  { path: "sla", label: "SLA breaches", requiresDashboardRole: true, render: (p) => <SlaBreachPage {...p} /> },
  { path: "customs", label: "Customs / NCS–NRS", requiresDashboardRole: true, render: (p) => <CustomsNrsPage {...p} /> },
  { path: "briefing", label: "Weekly briefing", requiresDashboardRole: true, render: (p) => <WeeklyBriefingPage {...p} /> },
];

function currentPath(): string {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return hash.length > 0 ? hash : "administration";
}

function useHashRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export default function App() {
  const [state, setState] = useState<ApplicationState>({ kind: "loading" });
  const [probeResults, setProbeResults] = useState<Record<string, ServiceProbeResult>>({});
  const [probeInFlight, setProbeInFlight] = useState<string | null>(null);
  const path = useHashRoute();

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
  const userRoles = useMemo(
    () => (state.kind === "ready" ? extractRoles(state.user, state.configuration.oidc.client_id) : []),
    [state],
  );
  const dashboardApiBase = useMemo(() => {
    if (state.kind !== "ready") {
      return null;
    }
    try {
      return resolveDashboardApiBase(state.configuration);
    } catch {
      return null;
    }
  }, [state]);

  const activeItem = NAVIGATION.find((item) => item.path === path) ?? NAVIGATION[0];
  const dashboardAllowed = hasAnyRole(userRoles, DASHBOARD_ROLES);

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

  function renderActivePage(): ReactElement {
    if (state.kind !== "ready") {
      return <></>;
    }
    if (activeItem.path === "administration") {
      return (
        <>
          <OnboardingPanel configuration={state.configuration.administration} token={token} />
          <ServiceDirectory
            services={state.configuration.services}
            authenticated={authenticated}
            probes={probeResults}
            probeInFlight={probeInFlight}
            onProbe={runProbe}
          />
        </>
      );
    }
    if (!authenticated) {
      return <SignInRequired />;
    }
    if (!dashboardAllowed) {
      return <RoleRequired roles={DASHBOARD_ROLES} observed={userRoles} />;
    }
    if (dashboardApiBase === null) {
      return (
        <section className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Integration gate active</p>
          <h2>Dashboard backend is not configured</h2>
          <p>The approved service registry does not define a backend origin for the executive dashboards. No substitute endpoint has been assumed.</p>
        </section>
      );
    }
    return activeItem.render({ baseUrl: dashboardApiBase, token });
  }

  return (
    <main className="portal-shell">
      <header className="masthead">
        <div className="brand-block">
          <p className="eyebrow">Federal Ministry Marine and Blue Economy</p>
          <h1>{title}</h1>
          <p className="brand-description">Executive oversight surface for authorised, interoperable Blue Economy services.</p>
        </div>
        <div className="session-panel" aria-live="polite">
          <span className={`status-dot ${authenticated ? "status-dot--success" : "status-dot--neutral"}`} />
          <span>{authenticated ? "Authenticated session" : "Authentication required"}</span>
          <InstallPrompt />
          {state.kind === "ready" && (
            authenticated ? <button className="button button--quiet" onClick={() => void startSignOut()}>Sign out</button> : <button className="button" onClick={() => void startSignIn()}>Sign in</button>
          )}
        </div>
      </header>

      {state.kind === "ready" && (
        <nav className="portal-nav" aria-label="Portal sections">
          {NAVIGATION.map((item) => {
            const locked = item.requiresDashboardRole && (!authenticated || !dashboardAllowed);
            return (
              <a
                key={item.path}
                className={`portal-nav__link ${item.path === activeItem.path ? "portal-nav__link--active" : ""} ${locked ? "portal-nav__link--locked" : ""}`}
                href={`#/${item.path}`}
                aria-current={item.path === activeItem.path ? "page" : undefined}
                title={locked ? "Requires a ministerial oversight role" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "configuration-error" && <ConfigurationError error={state.error} />}
      {state.kind === "ready" && renderActivePage()}
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

function SignInRequired() {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Controlled access</p>
      <h2>Sign in through the approved identity authority</h2>
      <p>Executive dashboards are available only to authenticated officers holding a ministerial oversight role.</p>
    </section>
  );
}

function RoleRequired({ roles, observed }: { roles: readonly string[]; observed: readonly string[] }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Role gate active</p>
      <h2>A ministerial oversight role is required</h2>
      <p>
        This section requires one of: {roles.join(", ")}.
        {observed.length === 0
          ? " No role claims were present on the session token."
          : ` Observed roles: ${observed.join(", ")}.`}
      </p>
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
