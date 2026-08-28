import assert from "node:assert/strict";
import test from "node:test";

import {
  availableActions,
  DECISION_REASON_MAX_LENGTH,
  queueSearchMatch,
  statusGuidance,
  validateDecisionForm,
} from "../src/approvals-model.ts";
import type { OnboardingRequestRecord } from "../src/administration-client.ts";

function recordWithStatus(status: string): OnboardingRequestRecord {
  return {
    id: "5f1b6d3c-9f2a-4b2e-8a3d-2f6f0a1b2c3d",
    organization_id: "blueeconomy-stakeholders",
    email: "stakeholder@example.gov.ng",
    first_name: "Amina",
    last_name: "Bello",
    requested_roles: ["nimasa-officer"],
    requester_subject: "officer-subject-1",
    status,
    created_at: "2026-08-28T09:30:00Z",
    updated_at: "2026-08-28T09:30:00Z",
  };
}

// The status transitions shown per state must mirror the backend lifecycle
// exactly: decide only where a decision is recordable, provision only from
// approved, activate only from invited, and nothing anywhere else.
test("availableActions mirrors the backend lifecycle per status", () => {
  const expectations: [string, string[]][] = [
    ["submitted", ["decide"]],
    ["identity_verified", ["decide"]],
    ["approved", ["provision"]],
    ["invited", ["activate"]],
    ["pending_verification", []],
    ["identity_review", []],
    ["provisioning", []],
    ["activating", []],
    ["active", []],
    ["rejected", []],
    ["identity_rejected", []],
    ["provisioning_failed", []],
    ["activation_failed", []],
    ["provisioning_ambiguous", []],
    ["activation_ambiguous", []],
    ["totally-unknown-state", []],
  ];
  for (const [status, actions] of expectations) {
    assert.deepEqual(availableActions(status), actions, `status ${status}`);
  }
});

test("statusGuidance explains every non-actionable state and stays silent on actionable ones", () => {
  for (const status of ["submitted", "identity_verified", "approved", "invited"]) {
    assert.equal(statusGuidance(recordWithStatus(status)), null, `status ${status} needs no guidance`);
  }
  for (const status of ["pending_verification", "identity_review", "provisioning", "activating", "active", "rejected", "identity_rejected", "provisioning_ambiguous", "activation_ambiguous", "provisioning_failed", "activation_failed"]) {
    const guidance = statusGuidance(recordWithStatus(status));
    assert.ok(guidance !== null && guidance.length > 0, `status ${status} must carry an honest explanation`);
  }
});

test("decision form requires a decision choice", () => {
  assert.ok(validateDecisionForm({ decision: "", reason: "" }).some((error) => error.includes("approve or reject")));
});

test("decision form requires a reason for rejection", () => {
  assert.ok(validateDecisionForm({ decision: "reject", reason: "   " }).some((error) => error.includes("reason")));
  assert.deepEqual(validateDecisionForm({ decision: "reject", reason: "duplicate identity evidence" }), []);
});

test("decision form accepts an approval without a reason", () => {
  assert.deepEqual(validateDecisionForm({ decision: "approve", reason: "" }), []);
});

test("decision form bounds the reason to the evidence column limit", () => {
  const oversized = "x".repeat(DECISION_REASON_MAX_LENGTH + 1);
  assert.ok(validateDecisionForm({ decision: "approve", reason: oversized }).some((error) => error.includes(String(DECISION_REASON_MAX_LENGTH))));
  assert.deepEqual(validateDecisionForm({ decision: "approve", reason: "x".repeat(DECISION_REASON_MAX_LENGTH) }), []);
});

test("queue search matches stakeholder fields case-insensitively and rejects non-matches", () => {
  const record = recordWithStatus("submitted");
  assert.ok(queueSearchMatch(record, "amina"));
  assert.ok(queueSearchMatch(record, "BELLO"));
  assert.ok(queueSearchMatch(record, "stakeholder@example.gov.ng"));
  assert.ok(queueSearchMatch(record, "blueeconomy"));
  assert.ok(queueSearchMatch(record, "amina bello"));
  assert.ok(queueSearchMatch(record, ""));
  assert.ok(!queueSearchMatch(record, "musa"));
});
