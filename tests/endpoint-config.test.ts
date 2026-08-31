import assert from "node:assert/strict";
import test from "node:test";

import {
  SAR_API_URL_ENV,
  STATISTICS_API_URL_ENV,
  resolveSarConsoleEndpoints,
  resolveStatisticsEndpoints,
} from "../src/endpoint-config.ts";

function clearEnv(): void {
  delete process.env[SAR_API_URL_ENV];
  delete process.env[STATISTICS_API_URL_ENV];
}

test("SAR endpoints fail closed with a clear error when VITE_SAR_API_URL is missing", () => {
  clearEnv();
  const result = resolveSarConsoleEndpoints();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /VITE_SAR_API_URL is not configured/);
  }
});

test("statistics endpoints fail closed with a clear error when VITE_STATISTICS_API_URL is missing", () => {
  clearEnv();
  const result = resolveStatisticsEndpoints();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /VITE_STATISTICS_API_URL is not configured/);
  }
});

test("endpoints reject non-HTTPS URLs and URLs with credentials, query or fragment", () => {
  clearEnv();
  for (const bad of [
    "http://sar.internal/v1",
    "https://user:pass@sar.example/v1",
    "https://sar.example/v1?token=abc",
    "https://sar.example/v1#frag",
    "not a url",
  ]) {
    process.env[SAR_API_URL_ENV] = bad;
    const result = resolveSarConsoleEndpoints();
    assert.equal(result.ok, false, `expected ${bad} to be rejected`);
  }
  clearEnv();
});

test("valid HTTPS endpoints resolve with trailing slashes stripped", () => {
  clearEnv();
  process.env[SAR_API_URL_ENV] = "https://mi.approved.example/";
  process.env[STATISTICS_API_URL_ENV] = "https://stats.approved.example/v1/stats/";
  const sar = resolveSarConsoleEndpoints();
  const stats = resolveStatisticsEndpoints();
  assert.ok(sar.ok);
  assert.ok(stats.ok);
  if (sar.ok) {
    assert.equal(sar.endpoints.sar_api_url, "https://mi.approved.example");
  }
  if (stats.ok) {
    assert.equal(stats.endpoints.statistics_api_url, "https://stats.approved.example/v1/stats");
  }
  clearEnv();
});
