export interface OidcRuntimeConfiguration {
  authority: string;
  client_id: string;
  redirect_uri: string;
  post_logout_redirect_uri?: string;
  scope: string;
}

export interface ServiceRuntimeConfiguration {
  id: string;
  label: string;
  health_url: string;
  required_roles: string[];
}

export interface AdministrationRuntimeConfiguration {
  onboarding_api_url: string;
  organization_id: string;
  allowed_roles: string[];
}

export interface AdministrationRuntimeConfiguration {
  onboarding_api_url: string;
  organization_id: string;
  allowed_roles: string[];
}

// GeospatialRuntimeConfiguration is the render-gated (decision D8) wiring
// for the #/tracking console and the GeoLibre pilot: every external resource
// the map touches — the geo-service API, the raster base tiles and the
// GeoLibre analysis app — comes from this deployment-supplied section, so the
// portal renders fully offline/sovereign when pointed at internal endpoints.
// The section is optional: without it the rest of the portal still runs and
// the tracking routes render an explicit "not configured" state rather than
// substituting any default endpoint.
export interface GeospatialRuntimeConfiguration {
  geo_api_url: string;
  tile_url: string;
  tile_attribution?: string;
  poll_interval_ms: number;
  cesium_base_url?: string;
  geolibre_enabled: boolean;
  geolibre_url?: string;
}

// RevenueRuntimeConfiguration is the render-gated wiring for the ministry
// revenue dashboards (W-FEAT-9): every upstream the dashboards read is a
// deployment-supplied approved endpoint — the BlueFare report surface of
// ferry-ticketing, the statutory tariff engine of financial-controls and the
// booking payment surface of port-interoperability. The section is OPTIONAL:
// without it the revenue routes render an explicit "not configured" state
// rather than substituting any default endpoint or cached figures.
export interface RevenueRuntimeConfiguration {
  /** Base URL of the ferry-ticketing API (BlueFare settlement/subsidy reports). */
  ferry_api_url: string;
  /** Base URL of the financial-controls tariff engine (rates, assessments, exemption audits). */
  tariff_api_url: string;
  /** Base URL of the port-interoperability API (booking payment receipts, refund state). */
  port_interop_api_url: string;
}

/**
 * Optional RUM (real-user monitoring) wiring, phase-7 OTel design. The
 * section is OPTIONAL: absent = browser telemetry disabled (the sanctioned
 * fail-open); the portal renders identically either way.
 */
export interface TelemetryRuntimeConfiguration {
  /**
   * OTLP/HTTP base URL of the cluster collector agent reachable from the
   * browser, e.g. "https://otel.example:4318". Plain HTTP is permitted here
   * (unlike business endpoints) because dev/in-cluster collectors are often
   * unencrypted; deployments should still prefer HTTPS via ingress.
   */
  otlp_endpoint: string;
  /** Trace sampling ratio in [0, 1]. Default 0.1 (10%). */
  sample_ratio: number;
}

export interface PortalRuntimeConfiguration {
  application_name: string;
  oidc: OidcRuntimeConfiguration;
  services: ServiceRuntimeConfiguration[];
  administration: AdministrationRuntimeConfiguration;
  geospatial?: GeospatialRuntimeConfiguration;
  telemetry?: TelemetryRuntimeConfiguration;
  revenue?: RevenueRuntimeConfiguration;
}

export const GEO_POLL_INTERVAL_DEFAULT_MS = 15_000;
export const GEO_POLL_INTERVAL_MIN_MS = 5_000;
export const GEO_POLL_INTERVAL_MAX_MS = 300_000;

export async function loadRuntimeConfiguration(url: string): Promise<PortalRuntimeConfiguration> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`runtime configuration request failed with HTTP ${response.status}`);
  }
  const candidate: unknown = await response.json();
  return validateRuntimeConfiguration(candidate);
}

export function validateRuntimeConfiguration(candidate: unknown): PortalRuntimeConfiguration {
  if (!isRecord(candidate)) {
    throw new Error("runtime configuration must be a JSON object");
  }
  const applicationName = requiredText(candidate, "application_name");
  const oidcCandidate = requiredRecord(candidate, "oidc");
  const oidc: OidcRuntimeConfiguration = {
    authority: validateHttpsUrl(requiredText(oidcCandidate, "authority"), "oidc.authority"),
    client_id: requiredText(oidcCandidate, "client_id"),
    redirect_uri: validateHttpsUrl(requiredText(oidcCandidate, "redirect_uri"), "oidc.redirect_uri"),
    scope: requiredText(oidcCandidate, "scope"),
  };
  const postLogout = optionalText(oidcCandidate, "post_logout_redirect_uri");
  if (postLogout !== undefined) {
    oidc.post_logout_redirect_uri = validateHttpsUrl(postLogout, "oidc.post_logout_redirect_uri");
  }

  const administrationCandidate = requiredRecord(candidate, "administration");
  const administrationRoles = administrationCandidate.allowed_roles;
  if (!Array.isArray(administrationRoles) || administrationRoles.length === 0 || !administrationRoles.every((role) => typeof role === "string" && role.trim().length > 0)) {
    throw new Error("administration.allowed_roles must be a non-empty string array");
  }
  const administration: AdministrationRuntimeConfiguration = {
    onboarding_api_url: validateHttpsUrl(requiredText(administrationCandidate, "onboarding_api_url"), "administration.onboarding_api_url"),
    organization_id: requiredText(administrationCandidate, "organization_id"),
    allowed_roles: administrationRoles.map((role) => role.trim()),
  };

  const servicesCandidate = candidate.services;
  if (!Array.isArray(servicesCandidate) || servicesCandidate.length === 0) {
    throw new Error("services must be a non-empty array of approved service definitions");
  }
  const identifiers = new Set<string>();
  const services = servicesCandidate.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`services[${index}] must be an object`);
    }
    const id = requiredText(value, "id");
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(id)) {
      throw new Error(`services[${index}].id must be a stable lower-case identifier`);
    }
    if (identifiers.has(id)) {
      throw new Error(`services contains duplicate id ${id}`);
    }
    identifiers.add(id);
    const roles = value.required_roles;
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((role) => typeof role === "string" && role.trim().length > 0)) {
      throw new Error(`services[${index}].required_roles must be a non-empty string array`);
    }
    return {
      id,
      label: requiredText(value, "label"),
      health_url: validateHttpsUrl(requiredText(value, "health_url"), `services[${index}].health_url`),
      required_roles: roles.map((role) => role.trim()),
    };
  });
  const geospatial = candidate.geospatial === undefined ? undefined : validateGeospatialConfiguration(requiredRecord(candidate, "geospatial"));
  const telemetry = candidate.telemetry === undefined ? undefined : validateTelemetryConfiguration(requiredRecord(candidate, "telemetry"));
  const revenue = candidate.revenue === undefined ? undefined : validateRevenueConfiguration(requiredRecord(candidate, "revenue"));
  return { application_name: applicationName, oidc, services, administration, ...(geospatial === undefined ? {} : { geospatial }), ...(telemetry === undefined ? {} : { telemetry }), ...(revenue === undefined ? {} : { revenue }) };
}

// validateRevenueConfiguration enforces the render-gated revenue wiring: all
// three upstream bases are required together (a partial section is rejected
// fail-closed rather than silently degrading one dashboard family) and each
// is an approved HTTPS endpoint exactly like every other business URL.
function validateRevenueConfiguration(candidate: Record<string, unknown>): RevenueRuntimeConfiguration {
  return {
    ferry_api_url: validateHttpsUrl(requiredText(candidate, "ferry_api_url"), "revenue.ferry_api_url"),
    tariff_api_url: validateHttpsUrl(requiredText(candidate, "tariff_api_url"), "revenue.tariff_api_url"),
    port_interop_api_url: validateHttpsUrl(requiredText(candidate, "port_interop_api_url"), "revenue.port_interop_api_url"),
  };
}

export const DEFAULT_TELEMETRY_SAMPLE_RATIO = 0.1;

function validateTelemetryConfiguration(candidate: Record<string, unknown>): TelemetryRuntimeConfiguration {
  const endpoint = validateTelemetryUrl(requiredText(candidate, "otlp_endpoint"), "telemetry.otlp_endpoint");
  const sampleRatio = candidate.sample_ratio ?? DEFAULT_TELEMETRY_SAMPLE_RATIO;
  if (typeof sampleRatio !== "number" || !Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) {
    throw new Error("telemetry.sample_ratio must be a number between 0 and 1");
  }
  return { otlp_endpoint: endpoint.replace(/\/+$/, ""), sample_ratio: sampleRatio };
}

/** HTTP(S) URL for the collector endpoint (HTTP allowed: dev/in-cluster OTLP). */
function validateTelemetryUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid HTTP(S) URL`);
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTP(S) URL without credentials, query parameters or fragments`);
  }
  return parsed.toString();
}

// validateGeospatialConfiguration enforces the render-gated map wiring: the
// geo API must be an approved HTTPS endpoint, the tile template may be an
// HTTPS URL or a same-origin absolute path (sovereign tile servers are
// commonly reverse-proxied onto the portal origin), and every URL stays free
// of credentials, query parameters and fragments exactly like the rest of
// the runtime configuration.
function validateGeospatialConfiguration(candidate: Record<string, unknown>): GeospatialRuntimeConfiguration {
  const geoApiUrl = validateHttpsUrl(requiredText(candidate, "geo_api_url"), "geospatial.geo_api_url");
  const tileUrl = validateTileTemplateUrl(requiredText(candidate, "tile_url"), "geospatial.tile_url");
  const tileAttribution = optionalText(candidate, "tile_attribution");
  const pollInterval = candidate.poll_interval_ms;
  if (pollInterval !== undefined && (typeof pollInterval !== "number" || !Number.isInteger(pollInterval) || pollInterval < GEO_POLL_INTERVAL_MIN_MS || pollInterval > GEO_POLL_INTERVAL_MAX_MS)) {
    throw new Error(`geospatial.poll_interval_ms must be an integer between ${GEO_POLL_INTERVAL_MIN_MS} and ${GEO_POLL_INTERVAL_MAX_MS}`);
  }
  const cesiumBaseUrl = optionalText(candidate, "cesium_base_url");
  if (cesiumBaseUrl !== undefined && !cesiumBaseUrl.startsWith("/")) {
    // Cesium assets are self-hosted (D5); only a same-origin path is
    // accepted so the build can never silently redirect them to a CDN.
    throw new Error("geospatial.cesium_base_url must be a same-origin absolute path (self-hosted Cesium assets)");
  }
  const geolibreEnabled = candidate.geolibre_enabled === true;
  const geolibreUrl = optionalText(candidate, "geolibre_url");
  const geospatial: GeospatialRuntimeConfiguration = {
    geo_api_url: geoApiUrl,
    tile_url: tileUrl,
    poll_interval_ms: pollInterval ?? GEO_POLL_INTERVAL_DEFAULT_MS,
    geolibre_enabled: geolibreEnabled,
    ...(tileAttribution === undefined ? {} : { tile_attribution: tileAttribution }),
    ...(cesiumBaseUrl === undefined ? {} : { cesium_base_url: cesiumBaseUrl }),
  };
  if (geolibreEnabled && geolibreUrl === undefined) {
    throw new Error("geospatial.geolibre_url is required when geospatial.geolibre_enabled is true");
  }
  if (geolibreUrl !== undefined) {
    // The GeoLibre iframe must be same-origin so the strict CSP frame-src
    // 'self' holds; a cross-origin analysis app is rejected fail-closed.
    if (!geolibreUrl.startsWith("/")) {
      throw new Error("geospatial.geolibre_url must be a same-origin absolute path (reverse-proxied GeoLibre deployment)");
    }
    geospatial.geolibre_url = geolibreUrl;
  }
  return geospatial;
}

function validateTileTemplateUrl(value: string, field: string): string {
  if (!value.includes("{z}") || !value.includes("{x}") || !value.includes("{y}")) {
    throw new Error(`${field} must be a raster tile template containing {z}, {x} and {y}`);
  }
  if (value.startsWith("/")) {
    if (value.includes("?") || value.includes("#") || value.startsWith("//")) {
      throw new Error(`${field} must not carry query parameters, fragments or a scheme-relative host`);
    }
    return value;
  }
  // Validate the HTTPS structure like every other configured URL, but keep
  // the literal template: URL serialisation would percent-encode the {z}
  // placeholders and break substitution by the map engines.
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTPS URL without credentials, query parameters or fragments`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = optionalText(record, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new Error(`${key} must be non-empty text`);
  }
  return value.trim();
}

function validateHttpsUrl(value: string, field: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTPS URL without credentials, query parameters or fragments`);
  }
  return parsed.toString();
}
