import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { accessToken, completeAuthenticationCallback, createUserManager } from "./auth";
import { OnboardingPanel } from "./OnboardingPanel";
import { ApprovalQueuePage } from "./ApprovalQueuePage";
import { ApprovalDetailPage } from "./ApprovalDetailPage";
import { loadRuntimeConfiguration, type PortalRuntimeConfiguration, type ServiceRuntimeConfiguration } from "./runtime-config";
import { initTelemetry } from "./telemetry";
import { heldClearance, heldRoles, isApprover } from "./roles";
import { isRevenueReader } from "./revenue/revenue-model";
import { RevenueOverviewPage } from "./revenue/RevenueOverviewPage";
import { SubsidyPage } from "./revenue/SubsidyPage";
import { SettlementPage } from "./revenue/SettlementPage";
import { AssessmentPage } from "./revenue/AssessmentPage";
import { isGeoReader, type Classification } from "./tracking/geo-model";
import { navigateTo, routeHref, useHashRoute, type Route } from "./router";

// The map engines (Cesium, MapLibre) and the GeoLibre embed are heavy and
// route-scoped: they load only when the operator navigates to the console,
// keeping the controlled-entry pages lean. The PBAC guard components are
// tiny and stay in the main bundle.
const TrackingPage = lazy(() => import("./tracking/TrackingPage").then((module) => ({ default: module.TrackingPage })));
const TrackingAccessNotice = lazy(() => import("./tracking/TrackingPage").then((module) => ({ default: module.TrackingAccessNotice })));
const GeoLibrePage = lazy(() => import("./tracking/GeoLibrePage").then((module) => ({ default: module.GeoLibrePage })));
import { probeService, type ServiceProbeResult } from "./service-client";

const RUNTIME_CONFIGURATION_URL = "/platform-config.json";

type ApplicationState =
  | { kind: "loading" }
  | { kind: "configuration-error"; error: string }
  | { kind: "ready"; configuration: PortalRuntimeConfiguration; manager: UserManager; user: User | null };

export default function App() {
  const [state, setState] = useState<ApplicationState>({ kind: "loading" });
  const route = useHashRoute();

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
  const roles = state.kind === "ready" ? heldRoles(state.user) : new Set<string>();
  const approver = isApprover(roles);
  const clearance = state.kind === "ready" ? heldClearance(state.user) : null;

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

  // onUnauthorized: the administration API rejected the token (401); route
  // the user back through the approved identity authority.
  function handleUnauthorized(): void {
    void startSignIn();
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

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "configuration-error" && <ConfigurationError error={state.error} />}
      {state.kind === "ready" && (
        <div className="portal-body">
          <SideNav route={route} />
          <div className="portal-content">
            <RoutedContent
              route={route}
              state={state}
              token={token}
              approver={approver}
              roles={roles}
              clearance={clearance}
              onSignIn={() => void startSignIn()}
              onUnauthorized={handleUnauthorized}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function SideNav({ route }: { route: Route }) {
  const approvalsActive = route.name === "approvals" || route.name === "approval-detail";
  return (
    <nav className="side-nav" aria-label="Portal sections">
      <a className={route.name === "overview" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "overview" })}>Overview</a>
      <a className={approvalsActive ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "approvals" })}>Approval queue</a>
      <a className={route.name === "tracking" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "tracking" })}>Vessel tracking</a>
      <a className={route.name === "geolibre" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "geolibre" })}>GeoLibre analysis</a>
      <a className={route.name === "revenue" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "revenue" })}>Revenue overview</a>
      <a className={route.name === "revenue-subsidy" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "revenue-subsidy" })}>Fare subsidies</a>
      <a className={route.name === "revenue-settlements" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "revenue-settlements" })}>Settlements</a>
      <a className={route.name === "revenue-assessments" ? "side-nav__link side-nav__link--active" : "side-nav__link"} href={routeHref({ name: "revenue-assessments" })}>Tariffs</a>
    </nav>
  );
}

interface RoutedContentProperties {
  route: Route;
  state: Extract<ApplicationState, { kind: "ready" }>;
  token: string | null;
  approver: boolean;
  roles: ReadonlySet<string>;
  clearance: Classification | null;
  onSignIn: () => void;
  onUnauthorized: () => void;
}

function RoutedContent({ route, state, token, approver, roles, clearance, onSignIn, onUnauthorized }: RoutedContentProperties) {
  if (route.name === "overview") {
    return <OverviewPage configuration={state.configuration} token={token} />;
  }
  // Guarded routes are gated by the observed role claims; the backends
  // remain the authoritative enforcers.
  if (token === null) {
    return <SignInRequired onSignIn={onSignIn} />;
  }
  // Revenue dashboards (W-FEAT-9): render-gated on the optional `revenue`
  // runtime section, role-gated on the observed report-reader roles; the
  // upstream services remain the authoritative enforcers.
  if (route.name === "revenue" || route.name === "revenue-subsidy" || route.name === "revenue-settlements" || route.name === "revenue-assessments") {
    if (state.configuration.revenue === undefined) {
      return <RevenueNotConfigured />;
    }
    if (!isRevenueReader(roles)) {
      return <RevenueInsufficientRole />;
    }
    if (route.name === "revenue") {
      return <RevenueOverviewPage configuration={state.configuration.revenue} token={token} onUnauthorized={onUnauthorized} />;
    }
    if (route.name === "revenue-subsidy") {
      return <SubsidyPage configuration={state.configuration.revenue} token={token} onUnauthorized={onUnauthorized} />;
    }
    if (route.name === "revenue-settlements") {
      return <SettlementPage configuration={state.configuration.revenue} token={token} onUnauthorized={onUnauthorized} />;
    }
    return <AssessmentPage configuration={state.configuration.revenue} token={token} onUnauthorized={onUnauthorized} />;
  }
  if (route.name === "geolibre") {
    return (
      <Suspense fallback={<MapLoadingNotice label="Loading the GeoLibre analysis panel" />}>
        <GeoLibrePage configuration={state.configuration.geospatial} />
      </Suspense>
    );
  }
  if (route.name === "tracking") {
    if (state.configuration.geospatial === undefined) {
      return <TrackingNotConfigured />;
    }
    return (
      <Suspense fallback={<MapLoadingNotice label="Loading the tracking console" />}>
        {isGeoReader(roles) ? (
          <TrackingPage
            configuration={state.configuration.geospatial}
            token={token}
            roles={roles}
            clearance={clearance}
            onUnauthorized={onUnauthorized}
          />
        ) : (
          <TrackingAccessNotice roles={roles} />
        )}
      </Suspense>
    );
  }
  if (!approver) {
    return <InsufficientRole />;
  }
  if (route.name === "approvals") {
    return (
      <ApprovalQueuePage
        configuration={state.configuration.administration}
        token={token}
        onUnauthorized={onUnauthorized}
        onOpenRequest={(id) => navigateTo({ name: "approval-detail", id })}
      />
    );
  }
  return (
    <ApprovalDetailPage
      configuration={state.configuration.administration}
      token={token}
      requestId={route.id}
      onUnauthorized={onUnauthorized}
      onBack={() => navigateTo({ name: "approvals" })}
    />
  );
}

function SignInRequired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Authentication required</p>
      <h2>Sign in to review the approval queue</h2>
      <p>The approver journey requires an authenticated session from the approved identity authority.</p>
      <button className="button" onClick={onSignIn}>Sign in</button>
    </section>
  );
}

function MapLoadingNotice({ label }: { label: string }) {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Console loading</p>
      <h2>{label}</h2>
      <p>The map engine assets are served from this deployment and load on demand.</p>
    </section>
  );
}

function TrackingNotConfigured() {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Geospatial integration not configured</p>
      <h2>The deployment has not wired the tracking console</h2>
      <p>The runtime configuration carries no <code>geospatial</code> section, so there is no approved geo-service endpoint or tile source to render. The portal does not substitute any default endpoint, tile provider or cached vessel data.</p>
    </section>
  );
}

function RevenueNotConfigured() {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Revenue integration not configured</p>
      <h2>The deployment has not wired the revenue dashboards</h2>
      <p>The runtime configuration carries no <code>revenue</code> section, so there are no approved ferry, tariff or port-interoperability endpoints to read. The portal does not substitute any default endpoint or cached revenue figures.</p>
    </section>
  );
}

function RevenueInsufficientRole() {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Insufficient role</p>
      <h2>Your account does not hold a revenue-reader role</h2>
      <p>The revenue dashboards mirror the ferry-ticketing report route policy: a report-reader role (<code>state-officer</code>, <code>niwa-officer</code>, <code>nimasa-observer</code>, <code>independent-auditor</code>, <code>auditor</code> or <code>fmmbe-oversight</code>) is required. The upstream services enforce this independently; the portal declines to render figures your session cannot authorise.</p>
    </section>
  );
}

function InsufficientRole() {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Insufficient role</p>
      <h2>Your account does not hold an approver role</h2>
      <p>The approval queue and the decision, provisioning and activation actions require the <code>platform-admin</code> or <code>nimasa-officer</code> role within your tenant. The administration API enforces this independently; this portal simply declines to render actions your session cannot perform.</p>
    </section>
  );
}

async function bootstrap(): Promise<Extract<ApplicationState, { kind: "ready" }>> {
  const configuration = await loadRuntimeConfiguration(RUNTIME_CONFIGURATION_URL);
  // RUM (phase-7 OTel): fire-and-forget — async, non-blocking, never in the
  // critical render path. No telemetry.otlp_endpoint in the runtime config =
  // telemetry disabled; init never rejects (sanctioned fail-open). This is
  // also the GeoLibre coverage point (OTEL_DESIGN.md §3): the GIS library is
  // client-side with no server telemetry, so its observability is the host
  // portal's RUM (fetch/XHR + web-vitals spans), nothing more.
  void initTelemetry({
    endpoint: configuration.telemetry?.otlp_endpoint,
    sampleRatio: configuration.telemetry?.sample_ratio,
    serviceName: "blueeconomy-ministry-portal",
    propagateTo: [
      configuration.administration.onboarding_api_url,
      ...configuration.services.map((service) => service.health_url),
      ...(configuration.geospatial === undefined ? [] : [configuration.geospatial.geo_api_url]),
      // Revenue dashboards (W-FEAT-9): the dashboard fetches reuse this one
      // traced path; propagation extends to the configured revenue upstreams.
      ...(configuration.revenue === undefined ? [] : [
        configuration.revenue.ferry_api_url,
        configuration.revenue.tariff_api_url,
        configuration.revenue.port_interop_api_url,
      ]),
    ],
  });
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

// sanitiseDiagnostic strips control characters and caps the length of the
// configuration diagnostic before it is rendered, so a hostile or malformed
// config payload cannot spray terminal escapes or an unbounded body into
// the page (React still performs the markup escaping).
function sanitiseDiagnostic(error: string): string {
  const cleaned = error.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}

function ConfigurationError({ error }: { error: string }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Integration gate active</p>
      <h2>Approved environment configuration is required</h2>
      <p>The portal did not load a valid runtime configuration. No substitute endpoint or local session has been created.</p>
      <pre>{sanitiseDiagnostic(error)}</pre>
    </section>
  );
}

interface OverviewPageProperties {
  configuration: PortalRuntimeConfiguration;
  token: string | null;
}

function OverviewPage({ configuration, token }: OverviewPageProperties) {
  const [probeResults, setProbeResults] = useState<Record<string, ServiceProbeResult>>({});
  const [probeInFlight, setProbeInFlight] = useState<string | null>(null);
  const authenticated = token !== null;

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
    <>
      <section className="assurance-banner">
        <span className="assurance-mark">Controlled access</span>
        <p>Service status is shown only after a live, authorised probe. This portal does not generate records, users, transactions or operational metrics.</p>
      </section>
      <OnboardingPanel configuration={configuration.administration} token={token} />
      <ServiceDirectory
        services={configuration.services}
        authenticated={authenticated}
        probes={probeResults}
        probeInFlight={probeInFlight}
        onProbe={runProbe}
      />
    </>
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
