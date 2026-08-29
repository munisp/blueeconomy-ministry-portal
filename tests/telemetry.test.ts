import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SAMPLE_RATIO,
  initTelemetry,
  isTelemetryEnabled,
  resolveSampleRatio,
} from "../src/telemetry.ts";
import { validateRuntimeConfiguration } from "../src/runtime-config.ts";

test("telemetry init guard: no endpoint => disabled, never throws", async () => {
  const handle = await initTelemetry({ serviceName: "test-portal" });
  assert.equal(handle.enabled, false);
  assert.match(handle.reason, /no OTLP endpoint/);
  await handle.shutdown();
});

test("telemetry init guard: blank endpoint is disabled", async () => {
  assert.equal(isTelemetryEnabled({}), false);
  assert.equal(isTelemetryEnabled({ endpoint: "" }), false);
  assert.equal(isTelemetryEnabled({ endpoint: "   " }), false);
  const handle = await initTelemetry({ endpoint: "  ", serviceName: "test-portal" });
  assert.equal(handle.enabled, false);
});

test("telemetry init: resolves (never rejects) in a non-DOM environment with an endpoint", async () => {
  // Node has no window/document: instrumentations cannot fully register.
  // The fail-open contract requires a resolved handle either way and a
  // shutdown that never rejects.
  const handle = await initTelemetry({
    endpoint: "http://127.0.0.1:4318",
    serviceName: "test-portal",
    sessionId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(typeof handle.enabled, "boolean");
  await handle.shutdown();
});

test("sampler: defaults to 10%", () => {
  assert.equal(DEFAULT_SAMPLE_RATIO, 0.1);
  assert.equal(resolveSampleRatio(undefined), 0.1);
});

test("sampler: honours an explicit ratio and degrades malformed values", () => {
  assert.equal(resolveSampleRatio(0.25), 0.25);
  assert.equal(resolveSampleRatio(0), 0);
  assert.equal(resolveSampleRatio(1), 1);
  assert.equal(resolveSampleRatio(Number.NaN), 0.1);
  assert.equal(resolveSampleRatio(2), 1);
  assert.equal(resolveSampleRatio(-0.5), 0);
});

const baseConfig = {
  application_name: "Blue Economy Platform",
  oidc: {
    authority: "https://issuer.example.invalid",
    client_id: "portal",
    redirect_uri: "https://portal.example.invalid/",
    scope: "openid profile",
  },
  administration: {
    onboarding_api_url: "https://admin.example.invalid",
    organization_id: "org-1",
    allowed_roles: ["approver"],
  },
  services: [
    { id: "geo-service", label: "Geo", health_url: "https://geo.example.invalid/health", required_roles: ["approver"] },
  ],
};

test("runtime config: telemetry section is optional", () => {
  const config = validateRuntimeConfiguration(baseConfig);
  assert.equal(config.telemetry, undefined);
});

test("runtime config: telemetry endpoint parsed, sample_ratio defaults to 10%", () => {
  const config = validateRuntimeConfiguration({
    ...baseConfig,
    telemetry: { otlp_endpoint: "https://otel.example.invalid:4318" },
  });
  assert.equal(config.telemetry?.otlp_endpoint, "https://otel.example.invalid:4318");
  assert.equal(config.telemetry?.sample_ratio, 0.1);
});

test("runtime config: plain HTTP collector endpoint accepted (dev/in-cluster OTLP)", () => {
  const config = validateRuntimeConfiguration({
    ...baseConfig,
    telemetry: { otlp_endpoint: "http://otel-collector.observability:4318", sample_ratio: 0.5 },
  });
  assert.equal(config.telemetry?.sample_ratio, 0.5);
});

test("runtime config: rejects out-of-range sample ratios and credential-bearing URLs", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig, telemetry: { otlp_endpoint: "https://otel.example.invalid:4318", sample_ratio: 1.5 } }),
    /telemetry\.sample_ratio/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig, telemetry: { otlp_endpoint: "https://user:pass@otel.example.invalid:4318" } }),
    /telemetry\.otlp_endpoint/,
  );
});
