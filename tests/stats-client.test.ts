import assert from "node:assert/strict";
import test from "node:test";

import type { StatisticsEndpoints } from "../src/endpoint-config.ts";
import { StatsApiError, getKpiRegistry, listRuns, probeStatsHealth, queryValues } from "../src/stats/stats-client.ts";

const ENDPOINTS: StatisticsEndpoints = { statistics_api_url: "https://stats.example.invalid/v1/stats" };

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string) => { status: number; body: unknown }): StubCall[] {
  const calls: StubCall[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const { status, body } = handler(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  };
  return calls;
}

const RUN = {
  run_id: "3f6d2a1c-9b0e-4c7a-8d5f-1e2b3a4c5d6e",
  computed_at: "2026-09-01T00:05:00Z",
  period: "2026-08",
  period_start: "2026-08-01T00:00:00Z",
  period_end: "2026-09-01T00:00:00Z",
  scope: "platform",
  source_table_versions: { platform_silver_events: 412 },
  query_definitions_sha256: "sha256:9c0ffee",
  kpi_count: 9,
  rows_emitted: 128,
  rows_no_data: 7,
  report_sha256: "sha256:beef1234",
};

const VALUE = {
  run_id: RUN.run_id,
  kpi_id: "vessel_calls",
  period: "2026-08",
  port_code: "NGLAG",
  ship_class: "container",
  value: 87,
  unit: "calls",
  n_observations: 87,
  percentile: null,
  coverage_note: null,
  definition_version: "1.0.0",
  source_table: "platform_gold_port_call_facts",
  table_version: 96,
  query_hash: "sha256:abc",
  computed_at: "2026-09-01T00:05:00Z",
  source_table_versions: { platform_silver_events: 412 },
};

test("getKpiRegistry parses the registry document with gaps", async () => {
  const calls = stubFetch(() => ({
    status: 200,
    body: {
      kpis: [
        { kpi_id: "vessel_calls", name: "Vessel calls", definition: "Count of distinct port calls…", unit: "calls", definition_version: "1.0.0", gap_id: null },
        { kpi_id: "berth_occupancy_pct", name: "Berth occupancy", definition: "Occupied berth-hours…", unit: "percent", definition_version: "1.0.0", gap_id: "GAP-STATS-BERTH-REF" },
      ],
      gaps: [
        { gap_id: "GAP-STATS-BERTH-REF", description: "No authoritative berth reference data…", needed_upstream: "Ministry berth reference dataset" },
      ],
    },
  }));
  const registry = await getKpiRegistry(ENDPOINTS, "token-1");
  assert.equal(registry.kpis.length, 2);
  assert.equal(registry.kpis[1].gap_id, "GAP-STATS-BERTH-REF");
  assert.equal(registry.gaps.length, 1);
  assert.equal(calls[0].url, "https://stats.example.invalid/v1/stats/kpis");
});

test("listRuns parses the provenance ledger and drops malformed manifests", async () => {
  stubFetch(() => ({ status: 200, body: { runs: [RUN, { run_id: "not-a-uuid" }] } }));
  const result = await listRuns(ENDPOINTS, "token-1");
  assert.equal(result.runs.length, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.runs[0].source_table_versions.platform_silver_events, 412);
});

test("queryValues serialises equality filters and parses exact gold rows", async () => {
  const calls = stubFetch(() => ({ status: 200, body: { values: [VALUE, { ...VALUE, port_code: null, ship_class: null, value: null, n_observations: 0, coverage_note: "no source events in period" }] } }));
  const result = await queryValues(ENDPOINTS, "token-1", { kpi_id: "vessel_calls", port_code: "NGLAG", period: "2026-08" });
  assert.equal(result.values.length, 2);
  const noData = result.values[1];
  assert.equal(noData.value, null);
  assert.equal(noData.port_code, null);
  assert.equal(noData.coverage_note, "no source events in period");
  assert.ok(calls[0].url.includes("kpi_id=vessel_calls"));
  assert.ok(calls[0].url.includes("port_code=NGLAG"));
  assert.ok(calls[0].url.includes("period=2026-08"));
});

test("queryValues validates filter shapes locally before calling the API", async () => {
  let called = 0;
  globalThis.fetch = () => {
    called += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  await assert.rejects(queryValues(ENDPOINTS, "token-1", { port_code: "lagos" }), StatsApiError);
  await assert.rejects(queryValues(ENDPOINTS, "token-1", { period: "2026-8" }), StatsApiError);
  assert.equal(called, 0);
});

test("statistics API failures surface truthful error kinds (401/403/503)", async () => {
  for (const status of [401, 403, 503]) {
    stubFetch(() => ({ status, body: { detail: "fail closed" } }));
    await assert.rejects(listRuns(ENDPOINTS, "token-1"), (error: unknown) => {
      assert.ok(error instanceof StatsApiError);
      assert.equal(error.kind, "http");
      assert.equal(error.status, status);
      return true;
    });
  }
});

test("probeStatsHealth is unauthenticated and never throws", async () => {
  const calls = stubFetch(() => ({ status: 200, body: { status: "ok" } }));
  assert.equal(await probeStatsHealth(ENDPOINTS), true);
  assert.equal(calls[0].url, "https://stats.example.invalid/v1/stats/health");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  stubFetch(() => ({ status: 503, body: {} }));
  assert.equal(await probeStatsHealth(ENDPOINTS), false);
  globalThis.fetch = () => Promise.reject(new TypeError("down"));
  assert.equal(await probeStatsHealth(ENDPOINTS), false);
});
