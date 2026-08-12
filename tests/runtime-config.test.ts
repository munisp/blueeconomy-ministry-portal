import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeConfiguration } from "../src/runtime-config.ts";

test("rejects a configuration without an approved service registry", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      application_name: "Blue Economy Platform",
      oidc: {
        authority: "https://issuer.example.invalid",
        client_id: "portal",
        redirect_uri: "https://portal.example.invalid/callback",
        scope: "openid profile",
      },
      services: [],
    }),
    /services must be a non-empty array/,
  );
});

test("rejects an insecure service health endpoint", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      application_name: "Blue Economy Platform",
      oidc: {
        authority: "https://issuer.example.invalid",
        client_id: "portal",
        redirect_uri: "https://portal.example.invalid/callback",
        scope: "openid profile",
      },
      services: [{
        id: "evidence",
        label: "Evidence",
        health_url: "http://service.example.invalid/health",
        required_roles: ["evidence.read"],
      }],
    }),
    /health_url must be an HTTPS URL/,
  );
});
