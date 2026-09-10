import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/api-client.ts";
import {
  KPI_ENDPOINTS,
  fetchMinisterialKpiPack,
  fetchWeeklyBriefing,
  validateMinisterialKpiPack,
  validateOperationalKpiReport,
  validateSlaBreachReport,
  validateTradeAnalyticsReport,
} from "../src/kpi-client.ts";

const VALID_PACK = {
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  revenue_collected_ngn: 1_250_000_000,
  declarations_cleared: 48_211,
  avg_clearance_hours: 43.5,
  interceptions: 312,
  coverage_pct: 96.4,
  sla_compliance_pct: 91.2,
};

test("accepts a well-formed ministerial KPI pack", () => {
  assert.deepEqual(validateMinisterialKpiPack(VALID_PACK), VALID_PACK);
});

test("rejects a KPI pack with a missing indicator", () => {
  const broken = { ...VALID_PACK } as Record<string, unknown>;
  delete broken.sla_compliance_pct;
  assert.throws(() => validateMinisterialKpiPack(broken), /sla_compliance_pct/);
});

test("rejects a KPI pack with a non-numeric indicator", () => {
  assert.throws(
    () => validateMinisterialKpiPack({ ...VALID_PACK, coverage_pct: "high" }),
    /coverage_pct must be a finite number/,
  );
});

test("rejects an operational KPI entry with an unknown status", () => {
  assert.throws(
    () => validateOperationalKpiReport({
      generated_at: "2026-08-31T00:00:00Z",
      entries: [{ id: "x", label: "X", value: 1, unit: "h", target: null, status: "green" }],
    }),
    /status must be on-track, at-risk or breach/,
  );
});

test("rejects an SLA breach with an unknown severity", () => {
  assert.throws(
    () => validateSlaBreachReport({
      generated_at: "2026-08-31T00:00:00Z",
      breaches: [{ service: "ncs", stage: "assessment", sla_hours: 48, elapsed_hours: 60, severity: "minor", reference: "REF-1" }],
    }),
    /severity must be warning or critical/,
  );
});

test("rejects trade analytics with malformed chapter rows", () => {
  assert.throws(
    () => validateTradeAnalyticsReport({
      window_days: 30,
      total_declarations: 1,
      total_duty_ngn: 1,
      top_hs_chapters: [{ chapter: "03", declarations: "many", duty_ngn: 10 }],
      daily: [],
    }),
    /declarations must be a finite number/,
  );
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

test("fetchMinisterialKpiPack issues an authorised request and validates the payload", async () => {
  const restore = stubFetch((url, init) => {
    assert.ok(url.endsWith(KPI_ENDPOINTS.executiveSummary));
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token-123");
    return new Response(JSON.stringify(VALID_PACK), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const pack = await fetchMinisterialKpiPack("https://gw.example.invalid", "token-123");
    assert.equal(pack.declarations_cleared, 48_211);
  } finally {
    restore();
  }
});

test("fetchMinisterialKpiPack fails closed on HTTP errors", async () => {
  const restore = stubFetch(() => new Response("nope", { status: 503 }));
  try {
    await assert.rejects(
      () => fetchMinisterialKpiPack("https://gw.example.invalid", "token-123"),
      (error: unknown) => error instanceof ApiError && error.kind === "http" && error.status === 503,
    );
  } finally {
    restore();
  }
});

test("fetchMinisterialKpiPack fails closed on malformed payloads", async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    await assert.rejects(
      () => fetchMinisterialKpiPack("https://gw.example.invalid", "token-123"),
      (error: unknown) => error instanceof ApiError && error.kind === "invalid-payload",
    );
  } finally {
    restore();
  }
});

test("fetchWeeklyBriefing fails closed with ApiError 404 when the endpoint is absent", async () => {
  const restore = stubFetch(() => new Response("not found", { status: 404 }));
  try {
    await assert.rejects(
      () => fetchWeeklyBriefing("https://gw.example.invalid", "token-123"),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
  } finally {
    restore();
  }
});

test("fetchWeeklyBriefing rejects an unsigned PDF response", async () => {
  const restore = stubFetch(() => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
  try {
    await assert.rejects(
      () => fetchWeeklyBriefing("https://gw.example.invalid", "token-123"),
      /did not carry a compact JWS signature/,
    );
  } finally {
    restore();
  }
});

test("fetchWeeklyBriefing accepts a JWS envelope carrying a PDF", async () => {
  const payload = Buffer.from("%PDF-1.7 fake").toString("base64");
  const restore = stubFetch(() => new Response(
    JSON.stringify({ payload, signature: "aaa.bbb.ccc", algorithm: "ES256" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  try {
    const briefing = await fetchWeeklyBriefing("https://gw.example.invalid", "token-123");
    assert.equal(briefing.signature, "aaa.bbb.ccc");
    assert.equal(briefing.signatureAlgorithm, "ES256");
    assert.equal(briefing.blob.type, "application/pdf");
    assert.ok(briefing.blob.size > 5);
  } finally {
    restore();
  }
});

test("fetchWeeklyBriefing rejects a JWS envelope whose payload is not a PDF", async () => {
  const payload = Buffer.from("definitely not a pdf").toString("base64");
  const restore = stubFetch(() => new Response(
    JSON.stringify({ payload, signature: "aaa.bbb.ccc" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  try {
    await assert.rejects(
      () => fetchWeeklyBriefing("https://gw.example.invalid", "token-123"),
      /not a PDF/,
    );
  } finally {
    restore();
  }
});

/* Phase 18: RL queue-policy shadow status */
import { fetchRlQueuePolicyStatus, validateRlQueuePolicyStatus } from "../src/kpi-client.ts";

const TRAINED_STATUS = {
  status: "ok",
  surface: "officer-export-queue",
  trained: true,
  policyVersion: "queue-policy-v0.2.1",
  opeScore: 0.77,
  mode: "shadow",
  note: "Shadow policy promoted — suggestions are advisory only.",
};

const UNTRAINED_STATUS = {
  status: "ok",
  surface: "officer-export-queue",
  trained: false,
  policyVersion: null,
  opeScore: null,
  mode: null,
  note: "Policy not trained — no promoted queue policy in the ml-stack registry.",
};

test("accepts a trained queue-policy status with OPE score", () => {
  assert.deepEqual(validateRlQueuePolicyStatus(TRAINED_STATUS), {
    surface: "officer-export-queue",
    trained: true,
    policyVersion: "queue-policy-v0.2.1",
    opeScore: 0.77,
    mode: "shadow",
    note: TRAINED_STATUS.note,
  });
});

test("accepts the first-class untrained status", () => {
  const parsed = validateRlQueuePolicyStatus(UNTRAINED_STATUS);
  assert.equal(parsed.trained, false);
  assert.equal(parsed.policyVersion, null);
  assert.equal(parsed.opeScore, null);
  assert.equal(parsed.mode, null);
});

test("rejects a non-shadow mode — RL output is advisory only", () => {
  assert.throws(
    () => validateRlQueuePolicyStatus({ ...TRAINED_STATUS, mode: "enforce" }),
    /mode must be "shadow" or null/,
  );
});

test("rejects a down payload — down must surface as an HTTP error, not data", () => {
  assert.throws(() => validateRlQueuePolicyStatus({ ...UNTRAINED_STATUS, status: "down" }), /status ok/);
});

test("rejects a non-boolean trained flag", () => {
  assert.throws(() => validateRlQueuePolicyStatus({ ...TRAINED_STATUS, trained: "yes" }), /trained must be a boolean/);
});

test("rejects a non-numeric OPE score when present", () => {
  assert.throws(
    () => validateRlQueuePolicyStatus({ ...TRAINED_STATUS, opeScore: "high" }),
    /opeScore must be a finite number/,
  );
});
