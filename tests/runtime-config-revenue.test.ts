import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeConfiguration } from "../src/runtime-config.ts";

function baseConfiguration() {
  return {
    application_name: "Blue Economy Platform",
    oidc: {
      authority: "https://issuer.example.invalid",
      client_id: "portal",
      redirect_uri: "https://portal.example.invalid/callback",
      scope: "openid profile",
    },
    administration: {
      onboarding_api_url: "https://admin.example.invalid/v1/onboarding/requests",
      organization_id: "approved-org",
      allowed_roles: ["stakeholder.onboarding.request"],
    },
    services: [{
      id: "evidence",
      label: "Evidence",
      health_url: "https://service.example.invalid/health",
      required_roles: ["evidence.read"],
    }],
  };
}

const validRevenue = {
  ferry_api_url: "https://ferry.example.invalid",
  tariff_api_url: "https://tariff.example.invalid",
  port_interop_api_url: "https://port.example.invalid",
};

test("revenue section is optional: an absent section validates with revenue undefined", () => {
  const configuration = validateRuntimeConfiguration(baseConfiguration());
  assert.equal(configuration.revenue, undefined);
});

test("revenue section: a complete HTTPS section validates and is carried through", () => {
  const configuration = validateRuntimeConfiguration({ ...baseConfiguration(), revenue: validRevenue });
  assert.equal(configuration.revenue?.ferry_api_url, "https://ferry.example.invalid/");
  assert.equal(configuration.revenue?.tariff_api_url, "https://tariff.example.invalid/");
  assert.equal(configuration.revenue?.port_interop_api_url, "https://port.example.invalid/");
});

test("revenue section: a partial section is rejected fail-closed", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfiguration(), revenue: { ferry_api_url: "https://ferry.example.invalid" } }),
    /tariff_api_url is required/,
  );
});

test("revenue section: plain-HTTP upstreams are rejected (business endpoints require HTTPS)", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfiguration(), revenue: { ...validRevenue, tariff_api_url: "http://tariff.example.invalid" } }),
    /revenue\.tariff_api_url must be an HTTPS URL/,
  );
});

test("revenue section: credentialed or query-carrying upstreams are rejected", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfiguration(), revenue: { ...validRevenue, ferry_api_url: "https://user:pw@ferry.example.invalid" } }),
    /revenue\.ferry_api_url must be an HTTPS URL/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfiguration(), revenue: { ...validRevenue, port_interop_api_url: "https://port.example.invalid/?x=1" } }),
    /revenue\.port_interop_api_url must be an HTTPS URL/,
  );
});
