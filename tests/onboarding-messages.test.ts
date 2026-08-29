import assert from "node:assert/strict";
import test from "node:test";

import { AdministrationApiError, ONBOARDING_OPERATOR_ROLES, describeSubmissionFailure } from "../src/administration-client.ts";

// Gap #14 (UI audit §9 item 9): a signed-in user lacking the operator role
// must see role-aware 403 feedback, not a bare HTTP status.
test("a 403 denial names the required onboarding-operator roles", () => {
  const error = new AdministrationApiError("http", 403, "onboarding request returned HTTP 403: forbidden");
  const message = describeSubmissionFailure(error);
  assert.ok(message.includes("HTTP 403"));
  for (const role of ONBOARDING_OPERATOR_ROLES) {
    assert.ok(message.includes(role), `expected the message to name ${role}`);
  }
  assert.ok(message.includes("tenant administrator"));
  // The role list mirrors the backend policy exactly (authz.go).
  assert.deepEqual(ONBOARDING_OPERATOR_ROLES, ["platform-admin", "nimasa-officer", "nwa-officer", "niwa-officer"]);
});

test("non-403 failures pass through the observed diagnostic unchanged", () => {
  const conflict = new AdministrationApiError("http", 409, "onboarding request returned HTTP 409: duplicate");
  assert.equal(describeSubmissionFailure(conflict), conflict.message);
  const network = new AdministrationApiError("network", null, "administration API could not be reached (fetch failed)");
  assert.equal(describeSubmissionFailure(network), network.message);
  assert.equal(describeSubmissionFailure(new Error("boom")), "boom");
  assert.equal(describeSubmissionFailure("boom"), "onboarding request failed");
});
