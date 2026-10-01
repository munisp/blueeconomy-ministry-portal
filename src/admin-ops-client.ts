import type { AdministrationRuntimeConfiguration } from "./runtime-config";

/**
 * Phase 22: client for the administration-service operator endpoints
 * (onboarding decision/provision/activate and NDPA privacy activities).
 *
 * Fail-closed doctrine: every call requires a real deployment-provided base
 * URL and a bearer token; backend HTTP status codes and error payloads are
 * surfaced verbatim — no mocked success, no swallowed error codes.
 */

const ONBOARDING_REQUESTS_SUFFIX = "/v1/onboarding/requests";

/**
 * Derives the administration-service API root from the configured onboarding
 * submission URL. Returns null when the configured URL does not carry the
 * expected /v1/onboarding/requests path, so the UI can refuse to operate
 * instead of guessing an endpoint.
 */
export function resolveAdministrationApiRoot(configuration: AdministrationRuntimeConfiguration): string | null {
  const normalized = configuration.onboarding_api_url.replace(/\/+$/, "");
  if (!normalized.endsWith(ONBOARDING_REQUESTS_SUFFIX)) {
    return null;
  }
  return normalized.slice(0, normalized.length - ONBOARDING_REQUESTS_SUFFIX.length);
}

export interface OnboardingDecisionResult {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface PrivacyProcessingActivity {
  id: string;
  activity_key: string;
  service_name: string;
  purpose: string;
  data_classifications: string[];
  external_recipients: string[];
  evidence_sha256: string;
  requester_subject: string;
  owner_subject: string;
  status: string;
  version: number;
  approval_conditions: string;
  approval_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePrivacyActivityInput {
  activity_key: string;
  service_name: string;
  purpose: string;
  data_classifications: string[];
  external_recipients: string[];
  evidence_sha256: string;
  owner_subject: string;
}

export interface PrivacyWorkflowInput {
  expected_version: number;
  reason: string;
  evidence_sha256: string;
}

export interface PrivacyDecisionInput extends PrivacyWorkflowInput {
  decision: "conditionally_approved" | "approved" | "rejected";
  approval_expires_at?: string;
}

/**
 * Reads the backend error payload ({"error": "..."}) when present and throws
 * an Error that keeps the HTTP status and backend message visible.
 */
async function assertOk(response: Response, operation: string): Promise<void> {
  if (response.ok) {
    return;
  }
  let detail = "";
  try {
    const candidate: unknown = await response.json();
    if (typeof candidate === "object" && candidate !== null && "error" in candidate && typeof candidate.error === "string") {
      detail = `: ${candidate.error}`;
    }
  } catch {
    // Non-JSON error body: status alone is still truthful.
  }
  throw new Error(`${operation} returned HTTP ${response.status}${detail}`);
}

async function post<T>(root: string, token: string, path: string, body: unknown, operation: string): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  await assertOk(response, operation);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function decideOnboardingRequest(
  root: string,
  token: string,
  id: string,
  decision: "approve" | "reject",
  reason: string,
): Promise<OnboardingDecisionResult> {
  return post(root, token, `/v1/onboarding/requests/${encodeURIComponent(id)}/decision`, { decision, reason }, "onboarding decision");
}

export function provisionOnboardingRequest(root: string, token: string, id: string): Promise<void> {
  return post(root, token, `/v1/onboarding/requests/${encodeURIComponent(id)}/provision`, {}, "onboarding provisioning");
}

export function activateOnboardingRequest(root: string, token: string, id: string, keycloakUserId: string): Promise<void> {
  return post(root, token, `/v1/onboarding/requests/${encodeURIComponent(id)}/activate`, { keycloak_user_id: keycloakUserId }, "onboarding activation");
}

export function createPrivacyActivity(root: string, token: string, input: CreatePrivacyActivityInput): Promise<PrivacyProcessingActivity> {
  return post(root, token, "/v1/privacy/activities", input, "privacy activity creation");
}

export async function getPrivacyActivity(root: string, token: string, id: string): Promise<PrivacyProcessingActivity> {
  const response = await fetch(`${root}/v1/privacy/activities/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  await assertOk(response, "privacy activity lookup");
  return (await response.json()) as PrivacyProcessingActivity;
}

export function attestPrivacyActivity(root: string, token: string, id: string, input: PrivacyWorkflowInput): Promise<PrivacyProcessingActivity> {
  return post(root, token, `/v1/privacy/activities/${encodeURIComponent(id)}/attest`, input, "privacy attestation");
}

export function submitPrivacyDpoReview(root: string, token: string, id: string, input: PrivacyWorkflowInput): Promise<PrivacyProcessingActivity> {
  return post(root, token, `/v1/privacy/activities/${encodeURIComponent(id)}/submit-dpo-review`, input, "privacy DPO-review submission");
}

export function decidePrivacyActivity(root: string, token: string, id: string, input: PrivacyDecisionInput): Promise<PrivacyProcessingActivity> {
  const body: Record<string, unknown> = {
    expected_version: input.expected_version,
    decision: input.decision,
    reason: input.reason,
    evidence_sha256: input.evidence_sha256,
  };
  if (input.approval_expires_at !== undefined) {
    body.approval_expires_at = input.approval_expires_at;
  }
  return post(root, token, `/v1/privacy/activities/${encodeURIComponent(id)}/decision`, body, "privacy decision");
}
