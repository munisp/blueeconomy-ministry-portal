import type { AdministrationRuntimeConfiguration } from "./runtime-config";

export interface OnboardingSubmission {
  organization_id: string;
  email: string;
  first_name: string;
  last_name: string;
  requested_roles: string[];
}

export interface OnboardingSubmissionResult {
  id: string;
  status: string;
}

// OnboardingRequestRecord mirrors the administration-service onboarding
// request DTO exactly (internal/admin OnboardingRequest); the queue list
// endpoint returns it and the decision verb returns the updated record.
export interface OnboardingRequestRecord {
  id: string;
  organization_id: string;
  email: string;
  first_name: string;
  last_name: string;
  requested_roles: string[];
  requester_subject: string;
  status: string;
  persona?: string;
  contact_channel?: string;
  contact_reference?: string;
  notification_status?: string;
  created_at: string;
  updated_at: string;
}

// OnboardingListPage mirrors the backend pagination envelope; next_offset is
// null when the current page reaches the end of the filtered set.
export interface OnboardingListPage {
  limit: number;
  offset: number;
  next_offset: number | null;
  total: number;
}

export interface OnboardingListResult {
  requests: OnboardingRequestRecord[];
  page: OnboardingListPage;
}

export interface OnboardingListQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

export type AdministrationErrorKind = "http" | "network" | "contract";

// AdministrationApiError carries the observed failure truthfully: the HTTP
// status for server responses (401/403/409/…), null for network failures,
// and the server-provided problem detail when the {"error": "…"} envelope
// carried one.
export class AdministrationApiError extends Error {
  readonly kind: AdministrationErrorKind;
  readonly status: number | null;

  constructor(kind: AdministrationErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "AdministrationApiError";
    this.kind = kind;
    this.status = status;
  }
}

function baseUrl(configuration: AdministrationRuntimeConfiguration): string {
  return configuration.onboarding_api_url.replace(/\/+$/, "");
}

async function readErrorEnvelope(response: Response): Promise<string | null> {
  try {
    const candidate: unknown = await response.json();
    if (typeof candidate === "object" && candidate !== null && "error" in candidate && typeof candidate.error === "string" && candidate.error.length > 0) {
      return candidate.error;
    }
  } catch {
    // A non-JSON error body carries no usable detail; the status stands alone.
  }
  return null;
}

async function administrationFetch(configuration: AdministrationRuntimeConfiguration, token: string, path: string, init: { method: string; body?: unknown }): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(configuration)}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    throw new AdministrationApiError("network", null, `administration API could not be reached (${error instanceof Error ? error.message : "network failure"})`);
  }
  if (!response.ok) {
    const detail = await readErrorEnvelope(response);
    const suffix = detail === null ? "" : `: ${detail}`;
    throw new AdministrationApiError("http", response.status, `administration API returned HTTP ${response.status}${suffix}`);
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AdministrationApiError("contract", response.status, "administration API returned a non-JSON response");
  }
}

export async function submitOnboardingRequest(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  submission: Omit<OnboardingSubmission, "organization_id">,
): Promise<OnboardingSubmissionResult> {
  let response: Response;
  try {
    response = await fetch(configuration.onboarding_api_url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      body: JSON.stringify({ ...submission, organization_id: configuration.organization_id }),
    });
  } catch (error) {
    throw new AdministrationApiError("network", null, `administration API could not be reached (${error instanceof Error ? error.message : "network failure"})`);
  }
  if (!response.ok) {
    const detail = await readErrorEnvelope(response);
    const suffix = detail === null ? "" : `: ${detail}`;
    throw new AdministrationApiError("http", response.status, `onboarding request returned HTTP ${response.status}${suffix}`);
  }
  const candidate: unknown = await readJson(response);
  if (!isSubmissionResult(candidate)) {
    throw new AdministrationApiError("contract", response.status, "onboarding API returned an unexpected response shape");
  }
  return candidate;
}

// listOnboardingRequests reads one page of the tenant-scoped approver queue
// (administration-service GET /v1/onboarding/requests).
export async function listOnboardingRequests(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  query: OnboardingListQuery = {},
): Promise<OnboardingListResult> {
  const parameters = new URLSearchParams();
  if (query.status !== undefined && query.status !== "") {
    parameters.set("status", query.status);
  }
  if (query.limit !== undefined) {
    parameters.set("limit", String(query.limit));
  }
  if (query.offset !== undefined && query.offset > 0) {
    parameters.set("offset", String(query.offset));
  }
  const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`;
  const response = await administrationFetch(configuration, token, suffix, { method: "GET" });
  const candidate: unknown = await readJson(response);
  if (!isListResult(candidate)) {
    throw new AdministrationApiError("contract", response.status, "onboarding queue returned an unexpected response shape");
  }
  return candidate;
}

// findOnboardingRequest locates one request inside the caller's tenant queue
// by paging the list endpoint (there is deliberately no get-by-id verb). The
// walk is bounded: at most MAX_LOOKUP_PAGES pages of MAX_LOOKUP_PAGE_SIZE.
// Returns null when the request is not visible in the caller's tenant queue.
export const MAX_LOOKUP_PAGE_SIZE = 100;
export const MAX_LOOKUP_PAGES = 10;

export async function findOnboardingRequest(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  id: string,
): Promise<OnboardingRequestRecord | null> {
  let offset = 0;
  for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
    const result = await listOnboardingRequests(configuration, token, { limit: MAX_LOOKUP_PAGE_SIZE, offset });
    const found = result.requests.find((request) => request.id === id);
    if (found !== undefined) {
      return found;
    }
    if (result.page.next_offset === null) {
      return null;
    }
    offset = result.page.next_offset;
  }
  return null;
}

export type OnboardingDecision = "approve" | "reject";

// submitOnboardingDecision posts the approver decision
// (POST /v1/onboarding/requests/{id}/decision) and returns the updated
// record as recorded by the backend.
export async function submitOnboardingDecision(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  id: string,
  decision: OnboardingDecision,
  reason: string,
): Promise<OnboardingRequestRecord> {
  const response = await administrationFetch(configuration, token, `/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: { decision, reason },
  });
  const candidate: unknown = await readJson(response);
  if (!isOnboardingRequest(candidate)) {
    throw new AdministrationApiError("contract", response.status, "decision response did not carry the updated onboarding request");
  }
  return candidate;
}

// provisionOnboardingRequest claims the approved request and triggers the
// Keycloak organization invitation (POST …/provision, 204 on success).
export async function provisionOnboardingRequest(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  id: string,
): Promise<void> {
  await administrationFetch(configuration, token, `/${encodeURIComponent(id)}/provision`, { method: "POST" });
}

// activateOnboardingRequest completes activation for an invited request with
// the registered Keycloak user id (POST …/activate, 204 on success).
export async function activateOnboardingRequest(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  id: string,
  keycloakUserId: string,
): Promise<void> {
  await administrationFetch(configuration, token, `/${encodeURIComponent(id)}/activate`, {
    method: "POST",
    body: { keycloak_user_id: keycloakUserId },
  });
}

function isSubmissionResult(value: unknown): value is OnboardingSubmissionResult {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "status" in value && typeof value.status === "string" && value.status.length > 0;
}

function isOnboardingRequest(value: unknown): value is OnboardingRequestRecord {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "organization_id" in value && typeof value.organization_id === "string" &&
    "email" in value && typeof value.email === "string" &&
    "first_name" in value && typeof value.first_name === "string" &&
    "last_name" in value && typeof value.last_name === "string" &&
    "requested_roles" in value && Array.isArray(value.requested_roles) && value.requested_roles.every((role) => typeof role === "string") &&
    "requester_subject" in value && typeof value.requester_subject === "string" &&
    "status" in value && typeof value.status === "string" && value.status.length > 0 &&
    "created_at" in value && typeof value.created_at === "string" &&
    "updated_at" in value && typeof value.updated_at === "string";
}

function isPage(value: unknown): value is OnboardingListPage {
  return typeof value === "object" && value !== null &&
    "limit" in value && typeof value.limit === "number" &&
    "offset" in value && typeof value.offset === "number" &&
    "next_offset" in value && (value.next_offset === null || typeof value.next_offset === "number") &&
    "total" in value && typeof value.total === "number";
}

function isListResult(value: unknown): value is OnboardingListResult {
  return typeof value === "object" && value !== null &&
    "requests" in value && Array.isArray(value.requests) && value.requests.every(isOnboardingRequest) &&
    "page" in value && isPage(value.page);
}
