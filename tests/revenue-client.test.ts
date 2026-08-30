import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRevenueError,
  fetchAssessment,
  fetchBookingReceipt,
  fetchExemptionAudits,
  fetchSettlementReport,
  fetchSubsidyReport,
  fetchTariffRates,
  RevenueApiError,
} from "../src/revenue/revenue-client.ts";
import type { RevenueRuntimeConfiguration } from "../src/runtime-config.ts";

const configuration: RevenueRuntimeConfiguration = {
  ferry_api_url: "https://ferry.example.invalid/",
  tariff_api_url: "https://tariff.example.invalid",
  port_interop_api_url: "https://port.example.invalid",
};

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function withFetch(stub: FetchStub, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/* Recorded upstream shapes (service ODBs):
 * - ferry-ticketing @ df6c147 internal/fare/store_settlement.go
 * - financial-controls @ 3bff518 internal/tariff/model.go + store.go
 *   (RateRow/ExemptionAudit serialise with capitalised Go field names)
 * - port-interoperability @ df9ed45 internal/booking/model.go */

const recordedSettlementAggregate = {
  operatorId: "lagos-ferry-co",
  periodStart: "2026-08-01",
  periodEnd: "2026-09-01",
  rides: 1240,
  grossNgnMinor: 9850000,
  subsidyNgnMinor: 1150000,
  operatorShareBps: 8500,
  operatorShareNgnMinor: 8372500,
  platformShareNgnMinor: 1477500,
};

const recordedSubsidyEnvelope = {
  routes: [
    { routeReference: "IKD-CMS", rides: 900, standardFareNgnMinor: 4500000, chargedNgnMinor: 3600000, subsidyNgnMinor: 900000 },
    { routeReference: "FALO-BADAGRY", rides: 340, standardFareNgnMinor: 2040000, chargedNgnMinor: 1790000, subsidyNgnMinor: 250000 },
  ],
};

const recordedRateRow = {
  RateID: "npa-ship-dues-2026a",
  Instrument: "NPA_SHIP_DUES",
  Agency: "NPA",
  BandLogic: "PER_GRT_BAND",
  Currency: "USD",
  RateMinorPerUnit: 320,
  RateBps: 0,
  BandFloor: 0,
  BandCeiling: null,
  StatutoryReference: "NPA Act s.12",
  Provisional: false,
  EffectiveFrom: "2026-01-01T00:00:00Z",
  EffectiveTo: null,
  State: "ACTIVE",
  Maker: "officer-a",
  Checker: "officer-b",
};

const recordedAssessment = {
  assessmentId: "7b8c1d2e-0000-4000-8000-111111111111",
  request: { vesselGrt: 42000, vesselClass: "CONTAINER", entityRef: "MSKU", cargoCategory: "CONTAINERISED", voyageType: "INTERNATIONAL", routeKind: "SEA", nigeriaPortCall: true, grossFreightUsdMinor: 250000000 },
  asOf: "2026-08-14",
  lines: [
    { lineNo: 1, instrument: "NPA_SHIP_DUES", agency: "NPA", applicability: "CHARGED", basis: "42000 GRT x 3.20 USD", statutoryReference: "NPA Act s.12", amountMinor: 13440000, currency: "USD" },
    { lineNo: 2, instrument: "SEA_PROTECTION_LEVY_2012", agency: "NIMASA", applicability: "EXEMPT", basis: "NLNG cabotage exemption", exemptionId: "ex-nlng-2012", amountMinor: 0, currency: "USD" },
  ],
  totalUsdMinor: 13440000,
  totalNgnMinor: 0,
  requester: "officer-a",
  correlationId: "corr-1",
  createdAt: "2026-08-14T10:00:00Z",
};

const recordedAuditEnvelope = {
  audits: [{
    AuditID: "aud-1",
    AssessmentID: "7b8c1d2e-0000-4000-8000-111111111111",
    ExemptionID: "ex-nlng-2012",
    Instrument: "SEA_PROTECTION_LEVY_2012",
    MatchKind: "VOYAGE_FLAG",
    MatchValue: "NLNG_SHUTTLE",
    StatutoryBasis: "Sea Protection Levy Regulations 2012 reg. 4",
    EvidenceRequirement: "NLNG shuttle voyage certificate",
    Requester: "officer-a",
    CreatedAt: "2026-08-14T10:00:01Z",
  }],
};

const recordedBooking = {
  booking_id: "2c3d4e5f-0000-4000-8000-222222222222",
  tenant_id: "tenant-apapa",
  request_id: "req-1",
  truck_plate: "KJA-221XA",
  trucker_msisdn: "+2348012345678",
  terminal_id: "terminal-apapa-1",
  channel: "WEB",
  status: "PAID",
  amount_kobo: 1500000,
  currency: "NGN",
  payment_receipt_ref: "tx-ref-9",
  ledger_commit_hash: "abc123",
  created_at: "2026-08-10T08:00:00Z",
  updated_at: "2026-08-10T08:05:00Z",
  expires_at: "2026-08-12T08:00:00Z",
  version: 4,
};

test("fetchSubsidyReport parses the recorded envelope and builds the period URL", async () => {
  await withFetch(async (input, init) => {
    const url = String(input);
    assert.equal(url, "https://ferry.example.invalid/v1/reports/subsidy?from=2026-08-01&to=2026-09-01");
    assert.equal(init?.method, "GET");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer token-1");
    return jsonResponse(200, recordedSubsidyEnvelope);
  }, async () => {
    const report = await fetchSubsidyReport(configuration, "token-1", "2026-08-01", "2026-09-01");
    assert.equal(report.routes.length, 2);
    assert.equal(report.routes[0].routeReference, "IKD-CMS");
  });
});

test("fetchSettlementReport parses the recorded aggregate and carries the operator id", async () => {
  await withFetch(async (input) => {
    assert.equal(String(input), "https://ferry.example.invalid/v1/reports/settlement?operatorId=lagos-ferry-co&from=2026-08-01&to=2026-09-01");
    return jsonResponse(200, recordedSettlementAggregate);
  }, async () => {
    const aggregate = await fetchSettlementReport(configuration, "token-1", "lagos-ferry-co", "2026-08-01", "2026-09-01");
    assert.equal(aggregate.grossNgnMinor, 9850000);
    assert.equal(aggregate.operatorShareBps, 8500);
  });
});

test("fetchTariffRates accepts the capitalised Go field names and null windows", async () => {
  await withFetch(async (input) => {
    assert.equal(String(input), "https://tariff.example.invalid/v1/tariffs/rates");
    return jsonResponse(200, { rates: [recordedRateRow] });
  }, async () => {
    const list = await fetchTariffRates(configuration, "token-1");
    assert.equal(list.rates[0].Agency, "NPA");
    assert.equal(list.rates[0].BandCeiling, null);
  });
});

test("fetchAssessment and fetchExemptionAudits parse the recorded shapes", async () => {
  await withFetch(async (input) => {
    const url = String(input);
    if (url.endsWith("/exemption-audits")) {
      return jsonResponse(200, recordedAuditEnvelope);
    }
    return jsonResponse(200, recordedAssessment);
  }, async () => {
    const assessment = await fetchAssessment(configuration, "token-1", recordedAssessment.assessmentId);
    assert.equal(assessment.lines.length, 2);
    assert.equal(assessment.lines[1].exemptionId, "ex-nlng-2012");
    const audits = await fetchExemptionAudits(configuration, "token-1", recordedAssessment.assessmentId);
    assert.equal(audits.audits[0].StatutoryBasis, "Sea Protection Levy Regulations 2012 reg. 4");
  });
});

test("fetchBookingReceipt parses the recorded booking with its receipt reference", async () => {
  await withFetch(async (input) => {
    assert.equal(String(input), "https://port.example.invalid/v1/bookings/2c3d4e5f-0000-4000-8000-222222222222");
    return jsonResponse(200, recordedBooking);
  }, async () => {
    const booking = await fetchBookingReceipt(configuration, "token-1", recordedBooking.booking_id);
    assert.equal(booking.status, "PAID");
    assert.equal(booking.payment_receipt_ref, "tx-ref-9");
  });
});

/* Error taxonomy: network / http / contract, and the 404 no-data case. */

test("error taxonomy: an unreachable endpoint is a network failure with null status", async () => {
  await withFetch(async () => {
    throw new TypeError("fetch failed");
  }, async () => {
    await assert.rejects(
      fetchTariffRates(configuration, "token-1"),
      (error: unknown) => {
        assert.ok(error instanceof RevenueApiError);
        assert.equal(error.kind, "network");
        assert.equal(error.status, null);
        assert.equal(error.service, "financial-controls");
        assert.equal(error.notFound(), false);
        return true;
      },
    );
  });
});

test("error taxonomy: a non-2xx response carries the status and the server error envelope", async () => {
  await withFetch(async () => jsonResponse(502, { error: "upstream timeout" }), async () => {
    await assert.rejects(
      fetchSubsidyReport(configuration, "token-1", "2026-08-01", "2026-09-01"),
      (error: unknown) => {
        assert.ok(error instanceof RevenueApiError);
        assert.equal(error.kind, "http");
        assert.equal(error.status, 502);
        assert.match(error.message, /HTTP 502: upstream timeout/);
        assert.equal(error.notFound(), false);
        return true;
      },
    );
  });
});

test("error taxonomy: 404 is the no-data case, distinct from an outage", async () => {
  await withFetch(async () => jsonResponse(404, { error: "tariff record not found" }), async () => {
    await assert.rejects(
      fetchAssessment(configuration, "token-1", "missing-id"),
      (error: unknown) => {
        assert.ok(error instanceof RevenueApiError);
        assert.equal(error.kind, "http");
        assert.equal(error.status, 404);
        assert.equal(error.notFound(), true);
        return true;
      },
    );
  });
});

test("error taxonomy: a drifted 2xx body is a contract failure, never partially trusted", async () => {
  await withFetch(async () => jsonResponse(200, { routes: [{ routeReference: "IKD-CMS", rides: "many" }] }), async () => {
    await assert.rejects(
      fetchSubsidyReport(configuration, "token-1", "2026-08-01", "2026-09-01"),
      (error: unknown) => {
        assert.ok(error instanceof RevenueApiError);
        assert.equal(error.kind, "contract");
        assert.match(error.message, /unexpected subsidy report shape/);
        return true;
      },
    );
  });
});

test("error taxonomy: a non-JSON 2xx body is a contract failure", async () => {
  await withFetch(async () => new Response("<html>proxy error</html>", { status: 200 }), async () => {
    await assert.rejects(
      fetchTariffRates(configuration, "token-1"),
      (error: unknown) => {
        assert.ok(error instanceof RevenueApiError);
        assert.equal(error.kind, "contract");
        assert.match(error.message, /non-JSON response/);
        return true;
      },
    );
  });
});

/* Empty-state honesty: classifyRevenueError distinguishes endpoint-down
 * from no-data, and routes 401/403 to their own states. */

test("classification: network failure and 5xx are endpoint-down (retryable), never no-data", () => {
  const provenance = { service: "ferry-ticketing" as const, method: "GET" as const, path: "/v1/reports/subsidy" };
  const network = classifyRevenueError(new RevenueApiError("network", null, "ferry-ticketing", provenance, "down"));
  assert.equal(network.kind, "endpoint-down");
  assert.equal(network.retryable, true);
  const fiveHundred = classifyRevenueError(new RevenueApiError("http", 500, "ferry-ticketing", provenance, "HTTP 500"));
  assert.equal(fiveHundred.kind, "endpoint-down");
  assert.equal(fiveHundred.retryable, true);
});

test("classification: 404 is no-data, 401 unauthorized, 403 forbidden", () => {
  const provenance = { service: "financial-controls" as const, method: "GET" as const, path: "/v1/tariffs/assessments/x" };
  assert.equal(classifyRevenueError(new RevenueApiError("http", 404, "financial-controls", provenance, "HTTP 404")).kind, "no-data");
  assert.equal(classifyRevenueError(new RevenueApiError("http", 401, "financial-controls", provenance, "HTTP 401")).kind, "unauthorized");
  assert.equal(classifyRevenueError(new RevenueApiError("http", 403, "financial-controls", provenance, "HTTP 403")).kind, "forbidden");
});

test("classification: unrecognised failures degrade to endpoint-down, never to an empty data set", () => {
  const classified = classifyRevenueError(new Error("mystery"));
  assert.equal(classified.kind, "endpoint-down");
  assert.equal(classified.retryable, true);
  assert.match(classified.detail, /mystery/);
});
