import assert from "node:assert/strict";
import test from "node:test";

import { GeoApiError, listSOS, listVessels, listZones, vesselTrack } from "../src/tracking/geo-client.ts";
import { bboxFromDegrees, bboxToQuery } from "../src/tracking/geo-model.ts";
import type { GeospatialRuntimeConfiguration } from "../src/runtime-config.ts";

const CONFIG: GeospatialRuntimeConfiguration = {
  geo_api_url: "https://geo.example.invalid/v1/geo",
  tile_url: "/tiles/{z}/{x}/{y}.png",
  poll_interval_ms: 15_000,
  geolibre_enabled: false,
};

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

// stubFetch installs a canned fetch and returns the recorded calls.
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

const VESSEL = {
  mmsi: "657123400",
  sourceClass: "AIS",
  latitudeMicros: 6_450_000,
  longitudeMicros: 3_379_000,
  speedOverGroundMilliknots: 12_340,
  courseOverGroundMillidegrees: 45_500,
  classification: "PUBLIC",
  observedAt: "2026-08-29T03:00:00Z",
};

test("listVessels maps validated records and serialises the bbox in micro-degrees", async () => {
  const calls = stubFetch(() => ({ status: 200, body: { vessels: [VESSEL] } }));
  const bbox = bboxFromDegrees(-2, 2.5, 15.5, 14.5);
  assert.ok(bbox !== null);
  const result = await listVessels(CONFIG, "token-1", bbox, 500);
  assert.equal(result.vessels.length, 1);
  assert.equal(result.dropped, 0);
  assert.equal(result.vessels[0].mmsi, "657123400");
  assert.ok(calls[0].url.startsWith("https://geo.example.invalid/v1/geo/vessels?"));
  assert.ok(calls[0].url.includes(`bbox=${encodeURIComponent(bboxToQuery(bbox))}`));
  assert.ok(calls[0].url.includes("limit=500"));
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-1");
});

test("listVessels omits the bbox parameter for the whole-world default", async () => {
  const calls = stubFetch(() => ({ status: 200, body: { vessels: [] } }));
  await listVessels(CONFIG, "token-1", null);
  assert.ok(!calls[0].url.includes("bbox="));
});

test("listVessels drops contract-violating records and counts them honestly", async () => {
  stubFetch(() => ({ status: 200, body: { vessels: [VESSEL, { ...VESSEL, latitudeMicros: 6.4 }, { ...VESSEL, sourceClass: "radar" }] } }));
  const result = await listVessels(CONFIG, "token-1", null);
  assert.equal(result.vessels.length, 1);
  assert.equal(result.dropped, 2);
});

test("listVessels fails closed on a wholly malformed envelope", async () => {
  stubFetch(() => ({ status: 200, body: { unexpected: true } }));
  await assert.rejects(() => listVessels(CONFIG, "token-1", null), (error: unknown) => {
    assert.ok(error instanceof GeoApiError);
    assert.equal(error.kind, "contract");
    return true;
  });
});

test("HTTP failures surface the observed status; network failures are kind network", async () => {
  stubFetch(() => ({ status: 403, body: { error: "principal has no tenant binding" } }));
  await assert.rejects(() => listVessels(CONFIG, "token-1", null), (error: unknown) => {
    assert.ok(error instanceof GeoApiError);
    assert.equal(error.kind, "http");
    assert.equal(error.status, 403);
    return true;
  });
  globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));
  await assert.rejects(() => listVessels(CONFIG, "token-1", null), (error: unknown) => {
    assert.ok(error instanceof GeoApiError);
    assert.equal(error.kind, "network");
    assert.equal(error.status, null);
    return true;
  });
});

test("vesselTrack requires a 9-digit MMSI and validates the GeoJSON shape", async () => {
  await assert.rejects(() => vesselTrack(CONFIG, "token-1", "123", "2026-08-28T00:00:00Z", "2026-08-29T00:00:00Z"), GeoApiError);
  const calls = stubFetch(() => ({ status: 200, body: { type: "LineString", coordinates: [[3.4, 6.4], [3.5, 6.45]] } }));
  const line = await vesselTrack(CONFIG, "token-1", "657123400", "2026-08-28T00:00:00Z", "2026-08-29T00:00:00Z");
  assert.deepEqual(line, [[3.4, 6.4], [3.5, 6.45]]);
  assert.ok(calls[0].url.includes("/vessels/657123400/track?"));
  assert.ok(calls[0].url.includes("from=2026-08-28"));
  stubFetch(() => ({ status: 200, body: { type: "FeatureCollection", features: [] } }));
  await assert.rejects(
    () => vesselTrack(CONFIG, "token-1", "657123400", "2026-08-28T00:00:00Z", "2026-08-29T00:00:00Z"),
    (error: unknown) => error instanceof GeoApiError && error.kind === "contract",
  );
});

test("listZones and listSOS validate their envelopes and records", async () => {
  stubFetch(() => ({
    status: 200,
    body: {
      zones: [{
        zoneId: "eez-ng",
        tenantId: "tenant-1",
        name: "Nigeria EEZ 200nm",
        classificationFloor: "PUBLIC",
        state: "approved",
        makerPrincipalId: "maker-1",
        createdAt: "2026-08-01T00:00:00Z",
        geoJson: JSON.stringify({ type: "Polygon", coordinates: [[[2, 4], [8, 4], [8, 10], [2, 10], [2, 4]]] }),
      }],
    },
  }));
  const zones = await listZones(CONFIG, "token-1");
  assert.equal(zones.zones.length, 1);
  assert.equal(zones.zones[0].name, "Nigeria EEZ 200nm");
  assert.ok(zones.zones[0].polygon !== null);

  stubFetch(() => ({
    status: 200,
    body: {
      sosAlerts: [
        {
          sosAlertId: "sos-1",
          reporterId: "reporter-7",
          latitudeMicros: 6_100_000,
          longitudeMicros: 3_200_000,
          recordedAt: "2026-08-29T02:00:00Z",
          classification: "RESTRICTED",
          state: "RAISED",
          receivedAt: "2026-08-29T02:00:04Z",
        },
        // Below the RESTRICTED contract floor: dropped, never rendered.
        {
          sosAlertId: "sos-2",
          reporterId: "reporter-8",
          latitudeMicros: 6_100_000,
          longitudeMicros: 3_200_000,
          recordedAt: "2026-08-29T02:05:00Z",
          classification: "PUBLIC",
          state: "RAISED",
          receivedAt: "2026-08-29T02:05:04Z",
        },
      ],
    },
  }));
  const sos = await listSOS(CONFIG, "token-1");
  assert.equal(sos.alerts.length, 1);
  assert.equal(sos.dropped, 1);
});
