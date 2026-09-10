import assert from "node:assert/strict";
import test from "node:test";

import { aggregateTransparencyTotals, jwsHeaderInfo, fetchTransparencyView } from "../src/transparency.ts";
import type { PortPerformanceReport } from "../src/kpi-client.ts";

function metric(value: number | null, source = "src") {
  return { source, value, delta_pct: null, unit: "tonnes" };
}

const REPORT: PortPerformanceReport = {
  generated_at: "2026-09-07T00:00:00Z",
  period: "quarterly",
  period_start: "2026-07-01",
  period_end: "2026-09-30",
  metrics: {
    cargo_throughput_tonnes: metric(1_200_000, "npa.vessel_ops.cargo_manifests"),
    vessel_calls: metric(500, "npa.port_call_log"),
    teu_in: metric(60_000, "npa.terminal_gate_moves"),
    teu_out: metric(55_000, "npa.terminal_gate_moves"),
    transshipment_volume_teu: metric(12_000, "npa.transshipment_register"),
    export_tonnes: metric(600_000),
    import_tonnes: metric(600_000),
  },
};

test("aggregates totals from backend-reported figures only", () => {
  const totals = aggregateTransparencyTotals(REPORT);
  assert.equal(totals.cargoThroughputTonnes, 1_200_000);
  assert.equal(totals.teuTotal, 115_000);
  assert.equal(totals.transshipmentTeu, 12_000);
  assert.equal(totals.vesselCalls, 500);
  assert.deepEqual(totals.sources, [
    "npa.vessel_ops.cargo_manifests",
    "npa.terminal_gate_moves",
    "npa.transshipment_register",
    "npa.port_call_log",
  ]);
});

test("null legs produce null totals (honest unavailable state, never a guess)", () => {
  const clone = structuredClone(REPORT);
  clone.metrics.teu_in = metric(null, "npa.terminal_gate_moves");
  clone.metrics.teu_out = metric(null, "npa.terminal_gate_moves");
  clone.metrics.transshipment_volume_teu = metric(null, "npa.transshipment_register");
  const totals = aggregateTransparencyTotals(clone);
  assert.equal(totals.teuTotal, null);
  assert.equal(totals.transshipmentTeu, null);
  assert.equal(totals.cargoThroughputTonnes, 1_200_000);
});

test("jwsHeaderInfo extracts alg and kid from a compact JWS header", () => {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "signing-key-2026Q3", typ: "JWT" })).toString("base64url");
  const info = jwsHeaderInfo(`${header}.payloadpart.signaturepart`);
  assert.equal(info?.algorithm, "EdDSA");
  assert.equal(info?.keyId, "signing-key-2026Q3");
});

test("jwsHeaderInfo returns null for malformed signatures and headers without kid", () => {
  assert.equal(jwsHeaderInfo("not-a-jws"), null);
  assert.equal(jwsHeaderInfo("a.b"), null);
  const noKid = Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url");
  const info = jwsHeaderInfo(`${noKid}.p.s`);
  assert.equal(info?.algorithm, "EdDSA");
  assert.equal(info?.keyId, null);
});

test("fetchTransparencyView keeps the report when the signed export is unavailable (provenance null)", async () => {
  (globalThis as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes("report.pdf")) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(REPORT), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const view = await fetchTransparencyView("https://nsw.example.com", "token");
  assert.equal(view.totals.teuTotal, 115_000);
  assert.equal(view.provenance, null);
});

test("fetchTransparencyView surfaces kid when the export carries a signed envelope", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "kpi-signer-1" })).toString("base64url");
  const payload = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).toString("base64");
  (globalThis as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes("report.pdf")) {
      return new Response(JSON.stringify({ payload, signature: `${header}.e30.sig`, algorithm: "EdDSA" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(REPORT), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const view = await fetchTransparencyView("https://nsw.example.com", "token");
  assert.equal(view.provenance?.keyId, "kpi-signer-1");
  assert.equal(view.provenance?.algorithm, "EdDSA");
});
