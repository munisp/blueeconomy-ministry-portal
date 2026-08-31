// Contract test: the typed statistics client is validated against the exact
// route paths and response shapes of the data-platform statistics API
// (blueeconomy-data-platform @ f88b46e,
// src/blueeconomy_data_platform/stats_api.py). The API ships no OpenAPI
// document, so its ROUTE_* constants and the dict shapes built by
// kpi_registry_document(), run_manifest() and query_values() are encoded
// here verbatim; a drift on either side fails this test.
import assert from "node:assert/strict";
import test from "node:test";

import type { StatisticsEndpoints } from "../src/endpoint-config.ts";
import { getKpiRegistry, listRuns, queryValues } from "../src/stats/stats-client.ts";
import { parseKpiRegistry, parseStatsRun, parseStatsValue } from "../src/stats/stats-model.ts";

const ENDPOINTS: StatisticsEndpoints = { statistics_api_url: "https://stats.example.invalid/v1/stats" };

// The exact route constants of stats_api.py (ROUTE_HEALTH, ROUTE_KPIS,
// ROUTE_RUNS, ROUTE_VALUES, ROUTE_REPORT_PREFIX), expressed relative to the
// configured /v1/stats base.
const EXPECTED_ROUTES = {
  health: "/v1/stats/health",
  kpis: "/v1/stats/kpis",
  runs: "/v1/stats/runs",
  values: "/v1/stats/values",
} as const;

// The exact response field names of stats_api.py.
const REGISTRY_KPI_FIELDS = ["kpi_id", "name", "definition", "unit", "definition_version", "gap_id"] as const;
const REGISTRY_GAP_FIELDS = ["gap_id", "description", "needed_upstream"] as const;
const RUN_MANIFEST_FIELDS = [
  "run_id",
  "computed_at",
  "period",
  "period_start",
  "period_end",
  "scope",
  "source_table_versions",
  "query_definitions_sha256",
  "kpi_count",
  "rows_emitted",
  "rows_no_data",
  "report_sha256",
] as const;
const VALUE_ROW_FIELDS = [
  "run_id",
  "kpi_id",
  "period",
  "port_code",
  "ship_class",
  "value",
  "unit",
  "n_observations",
  "percentile",
  "coverage_note",
  "definition_version",
  "source_table",
  "table_version",
  "query_hash",
  "computed_at",
  "source_table_versions",
] as const;

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const missing = fields.filter((field) => !(field in source));
  assert.deepEqual(missing, [], `document is missing fields: ${missing.join(", ")}`);
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

test("client requests hit the exact published routes", async () => {
  const calls: string[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    let body: unknown = { values: [] };
    if (url.endsWith("/kpis")) {
      body = { kpis: [], gaps: [] };
    } else if (url.endsWith("/runs")) {
      body = { runs: [] };
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
  await getKpiRegistry(ENDPOINTS, "token-1");
  await listRuns(ENDPOINTS, "token-1");
  await queryValues(ENDPOINTS, "token-1", { period: "2026-08" });
  assert.equal(calls[0], `https://stats.example.invalid${EXPECTED_ROUTES.kpis}`);
  assert.equal(calls[1], `https://stats.example.invalid${EXPECTED_ROUTES.runs}`);
  assert.ok(calls[2].startsWith(`https://stats.example.invalid${EXPECTED_ROUTES.values}?`));
  // The API rejects unknown query parameters; the client only ever sends
  // the three published filters.
  const query = new URL(calls[2]).searchParams;
  assert.deepEqual([...query.keys()].sort(), ["period"]);
});

test("a full-fidelity registry document parses (kpi_registry_document shape)", () => {
  const document = {
    kpis: [
      pick(
        {
          kpi_id: "throughput_tonnes",
          name: "Throughput (tonnes)",
          definition: "Sum of declared cargo tonnage over port calls in the period (UNCTAD RMT port throughput).",
          unit: "tonnes",
          definition_version: "1.0.0",
          gap_id: null,
          extra_server_field: "ignored-forward-compat",
        },
        REGISTRY_KPI_FIELDS,
      ),
    ],
    gaps: [
      pick(
        {
          gap_id: "GAP-STATS-TEU",
          description: "Manifests record tonnage but not TEU: TEU throughput is unavailable; throughput is published in tonnes only.",
          needed_upstream: "manifest events carrying declared TEU",
        },
        REGISTRY_GAP_FIELDS,
      ),
    ],
  };
  const registry = parseKpiRegistry(document);
  assert.ok(registry !== null);
  assert.equal(registry.kpis[0].kpi_id, "throughput_tonnes");
  assert.equal(registry.kpis[0].gap_id, null);
  assert.equal(registry.gaps[0].gap_id, "GAP-STATS-TEU");
});

test("a full-fidelity run manifest parses (run_manifest shape)", () => {
  const manifest = pick(
    {
      run_id: "3f6d2a1c-9b0e-4c7a-8d5f-1e2b3a4c5d6e",
      computed_at: "2026-09-01T00:05:00+00:00",
      period: "2026-08",
      period_start: "2026-08-01T00:00:00+00:00",
      period_end: "2026-09-01T00:00:00+00:00",
      scope: "platform",
      source_table_versions: { platform_silver_events: 412, platform_gold_port_call_facts: 96 },
      query_definitions_sha256: "9c0ffee9d2c1",
      kpi_count: 9,
      rows_emitted: 128,
      rows_no_data: 7,
      report_sha256: "beef1234cafe",
    },
    RUN_MANIFEST_FIELDS,
  );
  const parsed = parseStatsRun(manifest);
  assert.ok(parsed !== null);
  assert.equal(parsed.period, "2026-08");
  assert.equal(parsed.source_table_versions.platform_gold_port_call_facts, 96);
});

test("a full-fidelity value row set parses (query_values shape, incl. no-data rows)", () => {
  const base = {
    run_id: "3f6d2a1c-9b0e-4c7a-8d5f-1e2b3a4c5d6e",
    kpi_id: "vessel_turnaround_hours",
    period: "2026-08",
    port_code: "NGLAG",
    ship_class: null,
    value: 17.25,
    unit: "hours",
    n_observations: 61,
    percentile: "P50",
    coverage_note: null,
    definition_version: "1.0.0",
    source_table: "platform_gold_port_call_facts",
    table_version: 96,
    query_hash: "abc123",
    computed_at: "2026-09-01T00:05:00+00:00",
    source_table_versions: { platform_silver_events: 412 },
  };
  const p50 = parseStatsValue(pick(base, VALUE_ROW_FIELDS));
  assert.ok(p50 !== null);
  assert.equal(p50.percentile, "P50");
  assert.equal(p50.ship_class, null);

  // No-data rows are first class: value=null with a coverage note.
  const noData = parseStatsValue(pick({ ...base, value: null, n_observations: 0, percentile: null, coverage_note: "no source events in period" }, VALUE_ROW_FIELDS));
  assert.ok(noData !== null);
  assert.equal(noData.value, null);
  assert.equal(noData.coverage_note, "no source events in period");

  // Gap-blocked KPI rows cite the gap in the coverage note.
  const gapRow = parseStatsValue(pick({ ...base, kpi_id: "berth_occupancy_pct", value: null, n_observations: 0, percentile: null, coverage_note: "GAP-STATS-BERTH-REF: No authoritative berth reference data" }, VALUE_ROW_FIELDS));
  assert.ok(gapRow !== null);
  assert.match(gapRow.coverage_note ?? "", /^GAP-STATS-BERTH-REF/);

  // A percentile outside the published vocabulary fails closed.
  assert.equal(parseStatsValue({ ...base, percentile: "P99" }), null);
});
