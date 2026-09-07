import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/api-client.ts";
import {
  KPI_ENDPOINTS,
  exportImportBalanceTonnes,
  fetchPortPerformanceReport,
  fetchPortPerformanceReportPdf,
  validatePortPerformanceReport,
  type PortPerformanceReport,
} from "../src/kpi-client.ts";

function metric(value: number | null, delta_pct: number | null, unit = "tonnes", source = "npa.vessel_ops.cargo_manifests") {
  return { source, value, delta_pct, unit };
}

const VALID_REPORT: PortPerformanceReport = {
  generated_at: "2026-09-07T00:00:00Z",
  period: "weekly",
  period_start: "2026-09-01",
  period_end: "2026-09-07",
  metrics: {
    cargo_throughput_tonnes: metric(412_500, 3.2),
    vessel_calls: metric(187, -1.6, "calls", "npa.port_call_log"),
    teu_in: metric(21_340, 0.9, "TEU", "npa.terminal_gate_moves"),
    teu_out: metric(19_870, 1.4, "TEU", "npa.terminal_gate_moves"),
    transshipment_volume_teu: metric(4_120, null, "TEU", "npa.transshipment_register"),
    export_tonnes: metric(198_400, 2.1),
    import_tonnes: metric(214_100, 4.0),
  },
};

test("accepts a well-formed port performance report", () => {
  assert.deepEqual(validatePortPerformanceReport(VALID_REPORT), VALID_REPORT);
});

test("accepts a report whose metrics have no data (honest empty sections)", () => {
  const empty = structuredClone(VALID_REPORT);
  empty.metrics.cargo_throughput_tonnes = metric(null, null);
  empty.metrics.transshipment_volume_teu = metric(null, null, "TEU", "npa.transshipment_register");
  const validated = validatePortPerformanceReport(empty);
  assert.equal(validated.metrics.cargo_throughput_tonnes.value, null);
  assert.equal(validated.metrics.transshipment_volume_teu.delta_pct, null);
});

test("rejects an unknown reporting period", () => {
  assert.throws(
    () => validatePortPerformanceReport({ ...VALID_REPORT, period: "daily" }),
    /period must be weekly, monthly or quarterly/,
  );
});

test("rejects a metric with a non-numeric value", () => {
  const broken = structuredClone(VALID_REPORT) as unknown as { metrics: Record<string, unknown> };
  broken.metrics.vessel_calls = { source: "npa.port_call_log", value: "many", delta_pct: null, unit: "calls" };
  assert.throws(() => validatePortPerformanceReport(broken), /value must be a finite number or null/);
});

test("rejects a metric without a named data source", () => {
  const broken = structuredClone(VALID_REPORT) as unknown as { metrics: Record<string, unknown> };
  broken.metrics.teu_in = { value: 1, delta_pct: null, unit: "TEU" };
  assert.throws(() => validatePortPerformanceReport(broken), /source must be non-empty text/);
});

test("rejects a report missing a required metric section", () => {
  const broken = structuredClone(VALID_REPORT) as unknown as { metrics: Record<string, unknown> };
  delete broken.metrics.export_tonnes;
  assert.throws(() => validatePortPerformanceReport(broken), /metrics\.export_tonnes must be an object/);
});

test("export/import balance is export minus import when both legs have data", () => {
  assert.equal(exportImportBalanceTonnes(VALID_REPORT.metrics), 198_400 - 214_100);
});

test("export/import balance is null when either leg has no data", () => {
  const metrics = structuredClone(VALID_REPORT.metrics);
  metrics.export_tonnes = metric(null, null);
  assert.equal(exportImportBalanceTonnes(metrics), null);
  const metrics2 = structuredClone(VALID_REPORT.metrics);
  metrics2.import_tonnes = metric(null, null);
  assert.equal(exportImportBalanceTonnes(metrics2), null);
});

function stubFetch(handler: (url: string, init: RequestInit) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return Promise.resolve(handler(url, init ?? {}));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("fetchPortPerformanceReport issues an authorised period-scoped request", async () => {
  const restore = stubFetch((url, init) => {
    assert.ok(url.includes(`${KPI_ENDPOINTS.portPerformanceReport}?period=quarterly`), url);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token-xyz");
    return new Response(JSON.stringify(VALID_REPORT), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const report = await fetchPortPerformanceReport("https://gw.example.invalid", "token-xyz", "quarterly");
    assert.equal(report.metrics.vessel_calls.value, 187);
  } finally {
    restore();
  }
});

test("fetchPortPerformanceReport fails closed on malformed payloads", async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    await assert.rejects(
      () => fetchPortPerformanceReport("https://gw.example.invalid", "token-xyz", "weekly"),
      (error: unknown) => error instanceof ApiError && error.kind === "invalid-payload",
    );
  } finally {
    restore();
  }
});

test("fetchPortPerformanceReportPdf fails closed with ApiError 404 when the endpoint is absent", async () => {
  const restore = stubFetch(() => new Response("not found", { status: 404 }));
  try {
    await assert.rejects(
      () => fetchPortPerformanceReportPdf("https://gw.example.invalid", "token-xyz", "monthly"),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
  } finally {
    restore();
  }
});

test("fetchPortPerformanceReportPdf rejects an unsigned PDF response", async () => {
  const restore = stubFetch(() => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
  try {
    await assert.rejects(
      () => fetchPortPerformanceReportPdf("https://gw.example.invalid", "token-xyz", "weekly"),
      /did not carry a compact JWS signature/,
    );
  } finally {
    restore();
  }
});

test("fetchPortPerformanceReportPdf accepts a JWS-EdDSA envelope carrying a PDF (round-trip)", async () => {
  const pdfBytes = Buffer.from("%PDF-1.7 port performance report body");
  const payload = pdfBytes.toString("base64");
  const restore = stubFetch((url) => {
    assert.ok(url.includes(`${KPI_ENDPOINTS.portPerformanceReportPdf}?period=weekly`), url);
    return new Response(
      JSON.stringify({ payload, signature: "eyJhbGciOiJFZERTQSJ9.c2lnbmVk.c2ln", algorithm: "EdDSA" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    const signed = await fetchPortPerformanceReportPdf("https://gw.example.invalid", "token-xyz", "weekly");
    assert.equal(signed.signature, "eyJhbGciOiJFZERTQSJ9.c2lnbmVk.c2ln");
    assert.equal(signed.signatureAlgorithm, "EdDSA");
    assert.equal(signed.blob.type, "application/pdf");
    const roundTripped = Buffer.from(await signed.blob.arrayBuffer());
    assert.equal(roundTripped.toString(), pdfBytes.toString());
  } finally {
    restore();
  }
});

test("fetchPortPerformanceReportPdf rejects a JWS envelope whose payload is not a PDF", async () => {
  const payload = Buffer.from("not a pdf at all").toString("base64");
  const restore = stubFetch(() => new Response(
    JSON.stringify({ payload, signature: "a.b.c" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  try {
    await assert.rejects(
      () => fetchPortPerformanceReportPdf("https://gw.example.invalid", "token-xyz", "weekly"),
      /not a PDF/,
    );
  } finally {
    restore();
  }
});
