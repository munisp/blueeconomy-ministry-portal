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

export async function submitOnboardingRequest(
  configuration: AdministrationRuntimeConfiguration,
  token: string,
  submission: Omit<OnboardingSubmission, "organization_id">,
): Promise<OnboardingSubmissionResult> {
  const response = await fetch(configuration.onboarding_api_url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify({ ...submission, organization_id: configuration.organization_id }),
  });
  if (!response.ok) {
    throw new Error(`onboarding request returned HTTP ${response.status}`);
  }
  const candidate: unknown = await response.json();
  if (!isSubmissionResult(candidate)) {
    throw new Error("onboarding API returned an unexpected response shape");
  }
  return candidate;
}

function isSubmissionResult(value: unknown): value is OnboardingSubmissionResult {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "status" in value && typeof value.status === "string" && value.status.length > 0;
}
