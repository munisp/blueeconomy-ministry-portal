import assert from "node:assert/strict";
import test from "node:test";

import {
  GeoApiError,
  bboxToQuery,
  fetchCongestionForecast,
  fetchSosAlerts,
  fetchVesselsInBbox,
  isLiveSos,
  isObservationStale,
  microsToDegrees,
  parseInsufficientHistory,
  resolveGeoApiBase,
  validateCongestionForecastResult,
  validateSosList,
  validateVesselList,
  type CongestionForecastResult,
} from "../src/geo-client.ts";
import type { PortalRuntimeConfiguration } from "../src/runtime-config.ts";

const VALID_VESSEL = {
  mmsi: "123456789",
  vesselRef: "vref-1",
  sourceClass: "AIS",
  latitudeMicros: 6_450_000,
  longitudeMicros: 3_400_000,
  speedOverGroundMilliknots: 12_500,
  courseOverGroundMillidegrees: 90_000,
  classification: "PUBLIC",
  observedAt: "2026-09-10T10:00:00Z",
  shipName: "MV TEST",
  shipTypeCode: 70,
};

test("micro-degree conversion is exact at the boundary", () => {
  assert.equal(microsToDegrees(6_450_000), 6.45);
  assert.equal(microsToDegrees(-180_000_000), -180);
});

test("bbox serialises to fixed-point micro-degrees in minLon,minLat,maxLon,maxLat order", () => {
  assert.equal(bboxToQuery({ minLon: -2, minLat: 2.5, maxLon: 15.5, maxLat: 14.5 }), "-2000000,2500000,15500000,14500000");
});

test("staleness flags positions older than the threshold and unparseable timestamps", () => {
  const nowMs = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(isObservationStale("2026-09-10T11:50:00Z", nowMs), false);
  assert.equal(isObservationStale("2026-09-10T11:00:00Z", nowMs), true);
  assert.equal(isObservationStale("not-a-date", nowMs), true);
});

test("accepts a well-formed vessel list and converts units", () => {
  const result = validateVesselList({ vessels: [VALID_VESSEL] });
  assert.equal(result.vessels.length, 1);
  assert.equal(result.vessels[0].latitude, 6.45);
  assert.equal(result.vessels[0].speedKnots, 12.5);
  assert.equal(result.vessels[0].shipName, "MV TEST");
});

test("rejects vessels with malformed mmsi or non-integer micros", () => {
  assert.throws(() => validateVesselList({ vessels: [{ ...VALID_VESSEL, mmsi: "123" }] }), /mmsi must be 9 digits/);
  assert.throws(
    () => validateVesselList({ vessels: [{ ...VALID_VESSEL, latitudeMicros: 6.45 }] }),
    /latitudeMicros must be an integer/,
  );
});

test("accepts an honest empty vessel list", () => {
  assert.deepEqual(validateVesselList({ vessels: [] }), { vessels: [] });
});

test("resolveGeoApiBase returns the geo-service origin and null when absent (fail-closed)", () => {
  const configuration = {
    application_name: "Portal",
    oidc: { authority: "https://id.example.com", client_id: "c", redirect_uri: "https://p.example.com/", scope: "openid" },
    administration: { onboarding_api_url: "https://a.example.com", organization_id: "o", allowed_roles: ["r"] },
    services: [
      { id: "singlewindow", label: "NSW", health_url: "https://nsw.example.com/health", required_roles: ["r"] },
      { id: "geo-service", label: "Geo", health_url: "https://geo.example.com/healthz", required_roles: ["geo-reader"] },
    ],
  } satisfies PortalRuntimeConfiguration;
  assert.equal(resolveGeoApiBase(configuration), "https://geo.example.com");
  assert.equal(resolveGeoApiBase({ ...configuration, services: [configuration.services[0]] }), null);
});

/* --------------------------- congestion forecast ------------------------ */

function forecastPoint(step: number) {
  return { step, atUnix: 1_800_000_000 + step * 3600, queueLength: 5, lower80: 3, upper80: 7, lower95: 2, upper95: 8 };
}

const VALID_FORECAST: CongestionForecastResult = {
  port: "KEMBA",
  forecast: {
    portCode: "KEMBA",
    model: "seasonal-naive+holt-damped baseline v1.0.0",
    seasonalPeriod: 24,
    trainedOn: 500,
    points: [forecastPoint(1), forecastPoint(2)],
    backtestMAE: 0.9,
    backtestMAPE: 8.1,
    backtestNaiveMAE: 1.1,
    backtestNaiveMAPE: 10.4,
  },
  modelDisclaimer: "baseline statistical model; not a machine-learned model",
  provenance: { source: "port_queue_observations", asOf: "2026-09-10T10:00:00Z", stale: false, staleNote: null },
};

test("accepts a well-formed congestion forecast", () => {
  const validated = validateCongestionForecastResult(VALID_FORECAST);
  assert.equal(validated.forecast.points.length, 2);
  assert.equal(validated.provenance?.stale, false);
});

test("rejects a forecast without the honesty disclaimer or with non-numeric intervals", () => {
  const missing = { ...VALID_FORECAST } as Record<string, unknown>;
  delete missing.modelDisclaimer;
  assert.throws(() => validateCongestionForecastResult(missing), /modelDisclaimer must be non-empty text/);
  const broken = structuredClone(VALID_FORECAST) as unknown as { forecast: { points: Record<string, unknown>[] } };
  broken.forecast.points[0].upper95 = "wide";
  assert.throws(() => validateCongestionForecastResult(broken), /upper95 must be a finite number/);
});

test("parses the 409 INSUFFICIENT_HISTORY payload and ignores other error bodies", () => {
  const detail = parseInsufficientHistory({
    port: "TZDAR",
    error: "INSUFFICIENT_HISTORY: recorded queue series too short to forecast honestly",
    recordedObservations: 3,
    model: "seasonal-naive+holt-damped baseline v1.0.0",
  });
  assert.equal(detail?.recordedObservations, 3);
  assert.equal(parseInsufficientHistory({ error: "QUEUE_STORE_UNAVAILABLE: boom" }), null);
  assert.equal(parseInsufficientHistory(undefined), null);
});

/* --------------------------------- SOS ---------------------------------- */

const VALID_SOS = {
  sosAlertId: "sos-1",
  reporterId: "app-user-1",
  vesselReference: "MV DISTRESS",
  latitudeMicros: 6_100_000,
  longitudeMicros: 3_200_000,
  recordedAt: "2026-09-10T09:00:00Z",
  receivedAt: "2026-09-10T09:00:04Z",
  freeText: "Taking on water",
  classification: "RESTRICTED",
  state: "RAISED",
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedBy: null,
  resolvedAt: null,
};

test("accepts SOS alerts across the lifecycle and classifies live vs history", () => {
  const acknowledged = { ...VALID_SOS, sosAlertId: "sos-2", state: "ACKNOWLEDGED", acknowledgedBy: "op-1", acknowledgedAt: "2026-09-10T09:10:00Z" };
  const resolved = { ...VALID_SOS, sosAlertId: "sos-3", state: "RESOLVED", resolvedBy: "op-1", resolvedAt: "2026-09-10T11:00:00Z" };
  const result = validateSosList({ sosAlerts: [VALID_SOS, acknowledged, resolved] });
  assert.equal(result.sosAlerts.length, 3);
  assert.deepEqual(result.sosAlerts.map(isLiveSos), [true, true, false]);
  assert.equal(result.sosAlerts[0].latitude, 6.1);
});

test("rejects SOS alerts with an unknown lifecycle state (fail-closed)", () => {
  assert.throws(() => validateSosList({ sosAlerts: [{ ...VALID_SOS, state: "PENDING" }] }), /state must be one of/);
});

/* ------------------------------ transport ------------------------------- */

function mockFetch(status: number, body: unknown): void {
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("fetchCongestionForecast surfaces the 409 body for honest-refusal handling", async () => {
  mockFetch(409, { port: "KEMBA", error: "INSUFFICIENT_HISTORY: recorded queue series too short to forecast honestly", recordedObservations: 2, model: "baseline" });
  await assert.rejects(
    fetchCongestionForecast("https://geo.example.com", "token", "KEMBA"),
    (error: unknown) => {
      assert.ok(error instanceof GeoApiError);
      assert.equal(error.status, 409);
      assert.equal(parseInsufficientHistory(error.payload)?.recordedObservations, 2);
      return true;
    },
  );
});

test("fetchCongestionForecast rejects invalid port codes before any network call", async () => {
  let called = false;
  (globalThis as { fetch: unknown }).fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(fetchCongestionForecast("https://geo.example.com", "token", "ABC"), /5-letter UN\/LOCODE/);
  assert.equal(called, false);
});

test("fetchVesselsInBbox fails closed on schema-breaking payloads", async () => {
  mockFetch(200, { vessels: [{ mmsi: "123456789" }] });
  await assert.rejects(fetchVesselsInBbox("https://geo.example.com", "token", { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 }), (error: unknown) => {
    assert.ok(error instanceof GeoApiError);
    assert.equal(error.kind, "invalid-payload");
    return true;
  });
});

test("fetchSosAlerts propagates HTTP 403 with status intact for the clearance gate", async () => {
  mockFetch(403, { error: "forbidden: clearance" });
  await assert.rejects(fetchSosAlerts("https://geo.example.com", "token"), (error: unknown) => {
    assert.ok(error instanceof GeoApiError);
    assert.equal(error.status, 403);
    return true;
  });
});
