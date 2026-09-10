import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { accessToken, classifyAuthenticationError, completeAuthenticationCallback, createUserManager } from "./auth";
import { OnboardingPanel } from "./OnboardingPanel";
import { loadRuntimeConfiguration, type PortalRuntimeConfiguration, type ServiceRuntimeConfiguration } from "./runtime-config";
import { probeService, type ServiceProbeResult } from "./service-client";
import { resolveDashboardApiBase } from "./api-client";
import { DASHBOARD_ROLES, PLATFORM_ADMIN_ROLE, extractRoles, hasAnyRole } from "./roles";
import { InstallPrompt } from "./InstallPrompt";
import { ExecutiveDashboardPage } from "./pages/ExecutiveDashboardPage";
import { OperationalKpisPage } from "./pages/OperationalKpisPage";
import { TradeAnalyticsPage } from "./pages/TradeAnalyticsPage";
import { RiskModelPage } from "./pages/RiskModelPage";
import { SlaBreachPage } from "./pages/SlaBreachPage";
import { CustomsNrsPage } from "./pages/CustomsNrsPage";
import { MinisterialKpiPackPage } from "./pages/MinisterialKpiPackPage";
import { WeeklyBriefingPage } from "./pages/WeeklyBriefingPage";
import { PortPerformancePage } from "./pages/PortPerformancePage";
import { GeoHeatmapPage } from "./pages/GeoHeatmapPage";
import { CongestionForecastPage } from "./pages/CongestionForecastPage";
import { TransparencyPage } from "./pages/TransparencyPage";
import { IncidentSarPage } from "./pages/IncidentSarPage";
import { resolveGeoApiBase } from "./geo-client";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, useTranslation, type TranslationKey } from "./i18n";
import type { DashboardPageProps } from "./pages/props";

const RUNTIME_CONFIGURATION_URL = "/platform-config.json";

type ApplicationState =
  | { kind: "loading" }
  | { kind: "configuration-error"; error: string }
  | { kind: "authentication-error"; manager: UserManager; error: string }
  | { kind: "ready"; configuration: PortalRuntimeConfiguration; manager: UserManager; user: User | null };

interface NavigationItem {
  path: string;
  labelKey: TranslationKey;
  requiresDashboardRole: boolean;
  /** Additional roles required beyond the dashboard role (e.g. admin-only sections). */
  requiredRoles?: readonly string[];
  render: (properties: DashboardPageProps) => ReactElement;
}

const NAVIGATION: NavigationItem[] = [
  { path: "administration", labelKey: "nav.administration", requiresDashboardRole: false, render: () => <></> },
  { path: "kpi-pack", labelKey: "nav.kpiPack", requiresDashboardRole: true, render: (p) => <MinisterialKpiPackPage {...p} /> },
  { path: "executive", labelKey: "nav.executive", requiresDashboardRole: true, render: (p) => <ExecutiveDashboardPage {...p} /> },
  { path: "operational", labelKey: "nav.operational", requiresDashboardRole: true, render: (p) => <OperationalKpisPage {...p} /> },
  { path: "trade", labelKey: "nav.trade", requiresDashboardRole: true, render: (p) => <TradeAnalyticsPage {...p} /> },
  { path: "risk", labelKey: "nav.risk", requiresDashboardRole: true, render: (p) => <RiskModelPage {...p} /> },
  { path: "sla", labelKey: "nav.sla", requiresDashboardRole: true, render: (p) => <SlaBreachPage {...p} /> },
  { path: "customs", labelKey: "nav.customs", requiresDashboardRole: true, render: (p) => <CustomsNrsPage {...p} /> },
  { path: "briefing", labelKey: "nav.briefing", requiresDashboardRole: true, render: (p) => <WeeklyBriefingPage {...p} /> },
  {
    path: "port-performance",
    labelKey: "nav.portPerformance",
    requiresDashboardRole: true,
    requiredRoles: [PLATFORM_ADMIN_ROLE],
    render: (p) => <PortPerformancePage {...p} />,
  },
  { path: "geo-heatmap", labelKey: "nav.geoHeatmap", requiresDashboardRole: true, render: (p) => <GeoHeatmapPage {...p} /> },
  { path: "congestion-forecast", labelKey: "nav.congestionForecast", requiresDashboardRole: true, render: (p) => <CongestionForecastPage {...p} /> },
  // #13: transparency dashboard is intentionally gated to any ministerial
  // dashboard role (fmmbe-oversight/auditor included) rather than
  // platform-admin-only — it is the public-accountability view.
  { path: "transparency", labelKey: "nav.transparency", requiresDashboardRole: true, render: (p) => <TransparencyPage {...p} /> },
  { path: "incident-sar", labelKey: "nav.incidentSar", requiresDashboardRole: true, render: (p) => <IncidentSarPage {...p} /> },
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
  const [sessionExpiring, setSessionExpiring] = useState(false);

  // Token lifecycle: surface silent-renew outcomes instead of letting the
  // session silently lapse into "Authentication required".
  useEffect(() => {
    if (state.kind !== "ready") {
      return;
    }
    const { manager } = state;
    const onUserLoaded = (user: User) => {
      setSessionExpiring(false);
      setState((current) => (current.kind === "ready" ? { ...current, user } : current));
    };
    const onExpiring = () => setSessionExpiring(true);
    const onRenewError = (error: unknown) => {
      const message = error instanceof Error ? error.message : "automatic session renewal failed";
      setSessionExpiring(false);
      setState({ kind: "authentication-error", manager, error: message });
    };
    manager.events.addUserLoaded(onUserLoaded);
    manager.events.addAccessTokenExpiring(onExpiring);
    manager.events.addSilentRenewError(onRenewError);
    return () => {
      manager.events.removeUserLoaded(onUserLoaded);
      manager.events.removeAccessTokenExpiring(onExpiring);
      manager.events.removeSilentRenewError(onRenewError);
    };
  }, [state.kind === "ready" ? state.manager : null]);

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
  const { t, language, setLanguage } = useTranslation();
  const geoBaseUrl = state.kind === "ready" ? resolveGeoApiBase(state.configuration) : null;
  const tileStyleUrl = state.kind === "ready" ? state.configuration.geospatial?.tile_style_url : undefined;
  const configuredBbox = state.kind === "ready" ? state.configuration.geospatial?.default_bbox : undefined;
  const defaultBbox = configuredBbox === undefined
    ? undefined
    : { minLon: configuredBbox.min_lon, minLat: configuredBbox.min_lat, maxLon: configuredBbox.max_lon, maxLat: configuredBbox.max_lat };

  const activeItem = NAVIGATION.find((item) => item.path === path) ?? NAVIGATION[0];
  const dashboardAllowed = hasAnyRole(userRoles, DASHBOARD_ROLES);

  async function startSignIn(): Promise<void> {
    if (state.kind === "ready") {
      await state.manager.signinRedirect();
    } else if (state.kind === "authentication-error") {
      await state.manager.signinRedirect();
    }
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
    if (activeItem.requiredRoles !== undefined && !hasAnyRole(userRoles, activeItem.requiredRoles)) {
      return <RoleRequired roles={activeItem.requiredRoles} observed={userRoles} />;
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
    return activeItem.render({ baseUrl: dashboardApiBase, token, geoBaseUrl, tileStyleUrl, defaultBbox });
  }

  return (
    <main className="portal-shell">
      <header className="masthead">
        <div className="brand-block">
          <p className="eyebrow">{t("masthead.ministry")}</p>
          <h1>{title}</h1>
          <p className="brand-description">{t("masthead.description")}</p>
        </div>
        <div className="session-panel" aria-live="polite">
          <span className={`status-dot ${authenticated ? "status-dot--success" : "status-dot--neutral"}`} />
          <span>{authenticated ? t("session.authenticated") : t("session.required")}</span>
          <span className="language-switcher" role="group" aria-label={t("language.label")}>
            {SUPPORTED_LANGUAGES.map((candidate) => (
              <button
                key={candidate}
                className={`button ${candidate === language ? "" : "button--quiet"}`}
                aria-pressed={candidate === language}
                onClick={() => setLanguage(candidate)}
              >
                {LANGUAGE_LABELS[candidate]}
              </button>
            ))}
          </span>
          <InstallPrompt />
          {state.kind === "ready" && (
            authenticated
              ? <button className="button button--quiet" onClick={() => void startSignOut()}>{t("session.signOut")}</button>
              : <button className="button" onClick={() => void startSignIn()}>{t("session.signIn")}</button>
          )}
        </div>
      </header>

      {state.kind === "ready" && (
        <nav className="portal-nav" aria-label={t("nav.aria")}>
          {NAVIGATION.map((item) => {
            const roleLocked = item.requiredRoles !== undefined && !hasAnyRole(userRoles, item.requiredRoles);
            const locked = (item.requiresDashboardRole && (!authenticated || !dashboardAllowed)) || (authenticated && roleLocked);
            return (
              <a
                key={item.path}
                className={`portal-nav__link ${item.path === activeItem.path ? "portal-nav__link--active" : ""} ${locked ? "portal-nav__link--locked" : ""}`}
                href={`#/${item.path}`}
                aria-current={item.path === activeItem.path ? "page" : undefined}
                title={locked ? t("nav.lockedTitle") : undefined}
              >
                {t(item.labelKey)}
              </a>
            );
          })}
        </nav>
      )}

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "configuration-error" && <ConfigurationError error={state.error} />}
      {state.kind === "authentication-error" && (
        <SessionExpired error={state.error} onSignIn={() => void startSignIn()} />
      )}
      {state.kind === "ready" && sessionExpiring && <SessionExpiringNotice />}
      {state.kind === "ready" && renderActivePage()}
    </main>
  );
}

async function bootstrap(): Promise<ApplicationState> {
  // Only failures of the configuration load itself are configuration errors.
  const configuration = await loadRuntimeConfiguration(RUNTIME_CONFIGURATION_URL);
  const manager = createUserManager(configuration.oidc);
  let callbackUser: User | null = null;
  try {
    callbackUser = await completeAuthenticationCallback(manager);
  } catch (error: unknown) {
    // A stale / replayed callback ("No matching state found in storage" and
    // similar) is an expired sign-in session, not a broken deployment. The
    // URL has already been cleaned by completeAuthenticationCallback, so the
    // user can simply start a fresh redirect.
    const message = error instanceof Error ? error.message : "sign-in callback failed";
    if (classifyAuthenticationError(error) === "configuration") {
      throw error instanceof Error ? error : new Error(message);
    }
    return { kind: "authentication-error", manager, error: message };
  }
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

function SessionExpired({ error, onSignIn }: { error: string; onSignIn: () => void }) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Session ended</p>
      <h2>Sign-in session expired</h2>
      <p>The sign-in attempt could not be resumed. This is usually a stale or replayed sign-in link; starting a fresh sign-in resolves it.</p>
      <pre>{error}</pre>
      <button className="button" onClick={onSignIn}>Sign in again</button>
    </section>
  );
}

function SessionExpiringNotice() {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Session renewal</p>
      <p>Your session is about to expire and is being renewed automatically.</p>
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
