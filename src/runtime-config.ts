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

export interface PortalRuntimeConfiguration {
  application_name: string;
  oidc: OidcRuntimeConfiguration;
  services: ServiceRuntimeConfiguration[];
  administration: AdministrationRuntimeConfiguration;
}

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
  return { application_name: applicationName, oidc, services, administration };
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
