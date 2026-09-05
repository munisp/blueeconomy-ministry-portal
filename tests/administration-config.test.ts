import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdministrationOnboardingConfigured, type AdministrationRuntimeConfiguration } from "../src/runtime-config";

function administration(overrides: Partial<AdministrationRuntimeConfiguration> = {}): AdministrationRuntimeConfiguration {
  return {
    onboarding_api_url: "https://admin.blueeconomy.example.gov/api/onboarding",
    organization_id: "org-federal-ministry",
    allowed_roles: ["ministry-admin"],
    ...overrides,
  };
}

describe("isAdministrationOnboardingConfigured", () => {
  it("accepts real deployment values", () => {
    assert.equal(isAdministrationOnboardingConfigured(administration()), true);
  });

  it("rejects the observed placeholder onboarding API URL", () => {
    assert.equal(
      isAdministrationOnboardingConfigured(
        administration({ onboarding_api_url: "https://admin.blueeconomy.example.gov/placeholder-onboarding-api-not-yet-deployed" }),
      ),
      false,
    );
  });

  it("rejects the observed placeholder organization id", () => {
    assert.equal(
      isAdministrationOnboardingConfigured(administration({ organization_id: "PLACEHOLDER-ORG-NOT-YET-CONFIGURED" })),
      false,
    );
  });

  it("rejects other common placeholder markers in either field", () => {
    assert.equal(isAdministrationOnboardingConfigured(administration({ organization_id: "to-be-configured" })), false);
    assert.equal(isAdministrationOnboardingConfigured(administration({ organization_id: "changeme" })), false);
    assert.equal(
      isAdministrationOnboardingConfigured(administration({ onboarding_api_url: "https://onboarding.example.com/api" })),
      false,
    );
  });
});
