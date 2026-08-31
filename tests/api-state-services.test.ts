import assert from "node:assert/strict";
import test from "node:test";

import { classifyServiceError } from "../src/api-state.tsx";
import { SarApiError } from "../src/sar/sar-client.ts";
import { StatsApiError } from "../src/stats/stats-client.ts";

test("classifyServiceError routes 401 to re-authentication", () => {
  const classified = classifyServiceError(new SarApiError("http", 401, "unauthorized"), SarApiError, "maritime-intelligence service");
  assert.equal(classified.unauthorized, true);
  assert.equal(classified.retryable, false);
});

test("classifyServiceError renders 403 as an honest insufficient-role state", () => {
  const classified = classifyServiceError(new StatsApiError("http", 403, "insufficient role: stats-reader is required"), StatsApiError, "statistics API");
  assert.equal(classified.unauthorized, false);
  assert.equal(classified.retryable, false);
  assert.match(classified.detail, /HTTP 403/);
});

test("classifyServiceError marks network and contract failures retryable", () => {
  const network = classifyServiceError(new StatsApiError("network", null, "statistics API could not be reached"), StatsApiError, "statistics API");
  assert.equal(network.retryable, true);
  const contract = classifyServiceError(new SarApiError("contract", 200, "unexpected shape"), SarApiError, "maritime-intelligence service");
  assert.equal(contract.retryable, true);
  assert.match(contract.title, /contract violation/);
});

test("classifyServiceError never swallows an unknown error", () => {
  const classified = classifyServiceError(new Error("boom"), SarApiError, "maritime-intelligence service");
  assert.equal(classified.title, "Unexpected portal error");
  assert.match(classified.detail, /boom/);
});
