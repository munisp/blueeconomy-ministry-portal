import assert from "node:assert/strict";
import test from "node:test";

import type { SarConsoleEndpoints } from "../src/endpoint-config.ts";
import {
  SarApiError,
  getCase,
  getTimeline,
  listCases,
  listSitreps,
  listTaskings,
  listYaoundeReleases,
} from "../src/sar/sar-client.ts";

const ENDPOINTS: SarConsoleEndpoints = { sar_api_url: "https://mi.example.invalid" };

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

const CASE = {
  case_id: "sar-000001",
  incident_id: "inc-000502",
  phase: "ALERFA",
  stage: "INITIAL_ACTION",
  classification: "RESTRICTED",
  intake_kind: "GEO_SOS",
  source_ref: "sos-000118",
  created_by: "watchkeeper-7",
  created_at: "2026-08-29T12:14:02Z",
  updated_at: "2026-08-29T13:10:09Z",
  version: 2,
};

test("listCases sends the bearer token and serialises stage/phase filters", async () => {
  const calls = stubFetch(() => ({ status: 200, body: { cases: [CASE] } }));
  const result = await listCases(ENDPOINTS, "token-1", { stage: "COORDINATION", phase: "DETRESFA" });
  assert.equal(result.cases.length, 1);
  assert.equal(result.dropped, 0);
  assert.ok(calls[0].url.startsWith("https://mi.example.invalid/v1/sar/cases?"));
  assert.ok(calls[0].url.includes("stage=COORDINATION"));
  assert.ok(calls[0].url.includes("phase=DETRESFA"));
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-1");
});

test("listCases drops invalid records but keeps the valid ones", async () => {
  stubFetch(() => ({ status: 200, body: { cases: [CASE, { case_id: "broken" }] } }));
  const result = await listCases(ENDPOINTS, "token-1");
  assert.equal(result.cases.length, 1);
  assert.equal(result.dropped, 1);
});

test("listCases treats a malformed envelope as a contract error", async () => {
  stubFetch(() => ({ status: 200, body: { unexpected: true } }));
  await assert.rejects(listCases(ENDPOINTS, "token-1"), (error: unknown) => {
    assert.ok(error instanceof SarApiError);
    assert.equal(error.kind, "contract");
    return true;
  });
});

test("getCase maps 404 and 403 to truthful http errors", async () => {
  stubFetch(() => ({ status: 404, body: { error: "sar record not found" } }));
  await assert.rejects(getCase(ENDPOINTS, "token-1", "sar-999999"), (error: unknown) => {
    assert.ok(error instanceof SarApiError);
    assert.equal(error.kind, "http");
    assert.equal(error.status, 404);
    return true;
  });
  stubFetch(() => ({ status: 403, body: { error: "insufficient sar read scope or clearance" } }));
  await assert.rejects(getCase(ENDPOINTS, "token-1", "sar-000001"), (error: unknown) => {
    assert.ok(error instanceof SarApiError);
    assert.equal(error.status, 403);
    return true;
  });
});

test("getTimeline reads the case timeline route", async () => {
  const calls = stubFetch(() => ({
    status: 200,
    body: {
      entries: [
        { entry_id: "tle-1", case_id: "sar-000001", entry_type: "case.opened", actor: "watchkeeper-7", detail: {}, created_at: "2026-08-29T12:14:02Z" },
        { entry_id: "tle-2", case_id: "sar-000001", entry_type: "phase.changed", actor: "coordinator-2", detail: { phase: "ALERFA", prior_phase: "INCERFA" }, created_at: "2026-08-29T13:02:44Z" },
      ],
    },
  }));
  const result = await getTimeline(ENDPOINTS, "token-1", "sar-000001");
  assert.equal(result.entries.length, 2);
  assert.equal(calls[0].url, "https://mi.example.invalid/v1/sar/cases/sar-000001/timeline");
});

test("listTaskings and listSitreps read their case routes", async () => {
  const calls = stubFetch((url) => {
    if (url.endsWith("/taskings")) {
      return {
        status: 200,
        body: {
          taskings: [
            { tasking_id: "tsk-000001", case_id: "sar-000001", resource_id: "sru-db-07", task: "SEARCH_PATTERN", state: "ACKED", tasked_by: "coordinator-2", acked_by: "sru-db-07-ops", created_at: "2026-08-29T13:31:56Z", updated_at: "2026-08-29T13:44:10Z", version: 3 },
          ],
        },
      };
    }
    return {
      status: 200,
      body: {
        sitreps: [
          { sitrep_id: "sitrep-000001", case_id: "sar-000001", sequence: 1, body: { phase: "ALERFA" }, body_sha256: "sha256:d84d9ec6", envelope_jws: "eyJ", issued_by: "coordinator-2", issued_at: "2026-08-29T14:00:00Z" },
        ],
      },
    };
  });
  const taskings = await listTaskings(ENDPOINTS, "token-1", "sar-000001");
  const sitreps = await listSitreps(ENDPOINTS, "token-1", "sar-000001");
  assert.equal(taskings.taskings[0].state, "ACKED");
  assert.equal(sitreps.sitreps[0].sequence, 1);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://mi.example.invalid/v1/sar/cases/sar-000001/taskings", "https://mi.example.invalid/v1/sar/cases/sar-000001/sitrep"],
  );
});

test("listYaoundeReleases reads the release ledger for incident cross-links", async () => {
  const calls = stubFetch(() => ({
    status: 200,
    body: {
      releases: [
        { release_id: "ygr-000001", incident_id: "inc-000502", peer_id: "peer-mmcc-zone-e", marking: "YAOUNDE_ZONE_E", classification: "RESTRICTED", report_sha256: "sha256:bca5", state: "ACKNOWLEDGED", acked_at: "2026-08-28T04:00:00Z", ack_receipt_sha256: "sha256:ack", created_at: "2026-08-28T03:00:00Z", updated_at: "2026-08-28T04:00:00Z", version: 4 },
      ],
    },
  }));
  const result = await listYaoundeReleases(ENDPOINTS, "token-1");
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].state, "ACKNOWLEDGED");
  assert.equal(calls[0].url, "https://mi.example.invalid/v1/yaounde/releases");
});

test("a network failure is a network-kind error, never fabricated data", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));
  await assert.rejects(listCases(ENDPOINTS, "token-1"), (error: unknown) => {
    assert.ok(error instanceof SarApiError);
    assert.equal(error.kind, "network");
    assert.equal(error.status, null);
    return true;
  });
});
