import type { OnboardingDecision, OnboardingRequestRecord } from "./administration-client";

// Approver journey state model. Mirrors the administration-service lifecycle
// (README "Enrollment journeys"): the action set rendered for a record is
// derived only from its recorded status, and every derivation is total —
// unknown or internal states yield no actions rather than a guess.

export type ApproverAction = "decide" | "provision" | "activate";

// QUEUE_STATUS_FILTERS are the logical filters of the backend list endpoint,
// in display order; "" means the unfiltered queue.
export const QUEUE_STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending decision" },
  { value: "decided", label: "Approved (awaiting provisioning)" },
  { value: "provisioned", label: "Provisioned (invited)" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
];

// availableActions derives the truthful action set for one queue record:
//   submitted / identity_verified -> decide (approve or reject)
//   approved                      -> provision (Keycloak invitation)
//   invited                       -> activate (assign approved role groups)
// Every other state (pending KYC states, in-flight provisioning/activating,
// terminal and ambiguous states) has no approver action.
export function availableActions(status: string): ApproverAction[] {
  switch (status) {
    case "submitted":
    case "identity_verified":
      return ["decide"];
    case "approved":
      return ["provision"];
    case "invited":
      return ["activate"];
    default:
      return [];
  }
}

// statusGuidance is the honest explanation shown when a record is in a state
// where the approver cannot act, so the UI never silently hides the reason.
export function statusGuidance(record: OnboardingRequestRecord): string | null {
  switch (record.status) {
    case "pending_verification":
      return "This self-service enrollment is waiting for an officer to open identity proofing; no approver decision is possible yet.";
    case "identity_review":
      return "Identity proofing is in progress; a decision becomes possible only after a verification outcome is recorded.";
    case "provisioning":
      return "Provisioning (Keycloak invitation) is in flight for this request.";
    case "activating":
      return "Activation is in flight for this request.";
    case "provisioning_ambiguous":
    case "activation_ambiguous":
      return "An external operation ended in an ambiguous state and requires manual reconciliation; no further action is available here.";
    case "provisioning_failed":
    case "activation_failed":
      return "The external operation failed; the recorded evidence requires operator review.";
    case "active":
      return "This request is active; the approver journey is complete.";
    case "rejected":
    case "identity_rejected":
      return "This request was rejected; the approver journey is closed.";
    default:
      return null;
  }
}

// Decision form validation, mirroring the backend contract: decision must be
// approve or reject, and the recorded reason is bounded by the
// onboarding_decisions evidence column (1024 characters). A rejection must
// carry a reason so the evidence stream is actionable.
export const DECISION_REASON_MAX_LENGTH = 1024;

export interface DecisionFormValues {
  decision: OnboardingDecision | "";
  reason: string;
}

export function validateDecisionForm(values: DecisionFormValues): string[] {
  const errors: string[] = [];
  if (values.decision !== "approve" && values.decision !== "reject") {
    errors.push("Choose approve or reject.");
  }
  const reason = values.reason.trim();
  if (values.decision === "reject" && reason.length === 0) {
    errors.push("A rejection must record a reason for the evidence stream.");
  }
  if (reason.length > DECISION_REASON_MAX_LENGTH) {
    errors.push(`The reason must be at most ${DECISION_REASON_MAX_LENGTH} characters.`);
  }
  return errors;
}

// queueSearchMatch applies the queue page's client-side text filter to one
// record. It searches only the currently loaded page (the backend exposes no
// search verb); the UI labels it as such.
export function queueSearchMatch(record: OnboardingRequestRecord, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const haystack = [record.organization_id, record.email, record.first_name, record.last_name, record.id].join("\n").toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}
