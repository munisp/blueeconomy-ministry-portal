import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, resolveDashboardApiBase } from "../src/api-client.ts";
import type { PortalRuntimeConfiguration } from "../src/runtime-config.ts";

function configurationWith(services: PortalRuntimeConfiguration["services"]): PortalRuntimeConfiguration {
  return {
    application_name: "Portal",
    oidc: {
      authority: "https://id.example.com/realms/blueeconomy-cvff",
      client_id: "ministry-portal",
      redirect_uri: "https://portal.example.com/",
      scope: "openid profile",
    },
    administration: {
      onboarding_api_url: "https://admin.example.com",
      organization_id: "org-1",
      allowed_roles: ["nimasa-approver"],
    },
    services,
  };
}

test("resolves the dashboard base from the singlewindow registry entry", () => {
  const configuration = configurationWith([
    { id: "geo-service", label: "Geo", health_url: "https://geo.example.com/health", required_roles: ["fmmbe-oversight"] },
    { id: "singlewindow", label: "NSW", health_url: "https://nsw.example.com/v1/health", required_roles: ["fmmbe-oversight"] },
  ]);
  assert.equal(resolveDashboardApiBase(configuration), "https://nsw.example.com");
});

// Phase 19 M5 regression: a registry without an explicit `singlewindow`
// entry must fail closed with an honest misconfiguration error — never
// silently fall back to services[0] (which would fan the user's bearer
// token out to the wrong backend origin).
test("fails closed when no singlewindow service exists (no services[0] fallback)", () => {
  const configuration = configurationWith([
    { id: "geo-service", label: "Geo", health_url: "https://geo.example.com/health", required_roles: ["fmmbe-oversight"] },
  ]);
  assert.throws(() => resolveDashboardApiBase(configuration), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, "not-configured");
    assert.match(error.message, /singlewindow/);
    return true;
  });
});

test("fails closed on an empty registry", () => {
  const configuration = configurationWith([]);
  assert.throws(() => resolveDashboardApiBase(configuration), /no "singlewindow" service/);
});
