import assert from "node:assert/strict";
import test from "node:test";

import {
  bboxFromDegrees,
  bboxToQuery,
  canReadSOS,
  classificationCovers,
  formatCourseDegrees,
  formatSpeedKnots,
  isGeoReader,
  isStalePosition,
  isUnmatchedTrack,
  latitudeMicrosToDegrees,
  longitudeMicrosToDegrees,
  millidegreesToDegrees,
  milliknotsToKnots,
  parseClassification,
  parseGeoJsonPolygon,
  parseSOSAlert,
  parseSourceClass,
  parseTrackLineString,
  parseVesselSummary,
  sourceClassBadge,
  vesselDisplayName,
  vesselKey,
} from "../src/tracking/geo-model.ts";

test("fixed-point micro-degrees convert to degrees inside contract bounds", () => {
  assert.equal(latitudeMicrosToDegrees(6_450_000), 6.45);
  assert.equal(longitudeMicrosToDegrees(3_379_000), 3.379);
  assert.equal(latitudeMicrosToDegrees(-90_000_000), -90);
  assert.equal(longitudeMicrosToDegrees(180_000_000), 180);
  // Out-of-range and non-integer (floating-point coordinates are prohibited).
  assert.equal(latitudeMicrosToDegrees(90_000_001), null);
  assert.equal(longitudeMicrosToDegrees(-180_000_001), null);
  assert.equal(latitudeMicrosToDegrees(6.45), null);
  assert.equal(latitudeMicrosToDegrees(Number.NaN), null);
});

test("milli-knots and milli-degrees convert and format fail-closed", () => {
  assert.equal(milliknotsToKnots(12_340), 12.34);
  assert.equal(milliknotsToKnots(0), 0);
  assert.equal(milliknotsToKnots(-1), null);
  assert.equal(milliknotsToKnots(1.5), null);
  assert.equal(millidegreesToDegrees(45_500), 45.5);
  assert.equal(millidegreesToDegrees(359_999), 359.999);
  assert.equal(millidegreesToDegrees(360_000), null);
  assert.equal(millidegreesToDegrees(-1), null);
  assert.equal(formatSpeedKnots(12_340), "12.3 kn");
  assert.equal(formatSpeedKnots(-5), "not reported");
  assert.equal(formatCourseDegrees(45_000), "045°");
  assert.equal(formatCourseDegrees(7_000), "007°");
  assert.equal(formatCourseDegrees(360_000), "not reported");
});

test("source-class taxonomy is fail-closed and badges map per tier", () => {
  assert.equal(parseSourceClass("AIS"), "AIS");
  assert.equal(parseSourceClass("GSM_TRACKER"), "GSM_TRACKER");
  assert.equal(parseSourceClass("SAT_TRACKER"), "SAT_TRACKER");
  assert.equal(parseSourceClass("APP_REPORT"), "APP_REPORT");
  // Free-text or unknown sources are refused, never coerced.
  assert.equal(parseSourceClass("radar"), null);
  assert.equal(parseSourceClass(""), null);
  assert.equal(parseSourceClass(7), null);
  assert.equal(sourceClassBadge("AIS"), "AIS");
  assert.equal(sourceClassBadge("GSM_TRACKER"), "GSM");
  assert.equal(sourceClassBadge("SAT_TRACKER"), "SAT");
  assert.equal(sourceClassBadge("APP_REPORT"), "APP");
});

test("classification ladder covers upward and rejects unknown labels", () => {
  assert.equal(parseClassification("RESTRICTED"), "RESTRICTED");
  assert.equal(parseClassification("nope"), null);
  assert.equal(parseClassification(3), null);
  assert.ok(classificationCovers("SECRET", "PUBLIC"));
  assert.ok(classificationCovers("RESTRICTED", "RESTRICTED"));
  assert.ok(!classificationCovers("INTERNAL", "RESTRICTED"));
  assert.ok(!classificationCovers("PUBLIC", "SECRET"));
});

const VALID_VESSEL = {
  mmsi: "657123400",
  vesselRef: "vr-9f2",
  sourceClass: "AIS",
  latitudeMicros: 6_450_000,
  longitudeMicros: 3_379_000,
  speedOverGroundMilliknots: 12_340,
  courseOverGroundMillidegrees: 45_500,
  classification: "PUBLIC",
  observedAt: "2026-08-29T03:00:00Z",
  shipName: "MV EKO ATLANTIC",
  shipTypeCode: 70,
};

test("vessel summary parses a contract-conformant record", () => {
  const vessel = parseVesselSummary(VALID_VESSEL);
  assert.ok(vessel !== null);
  assert.equal(vessel.mmsi, "657123400");
  assert.equal(vessel.shipName, "MV EKO ATLANTIC");
  assert.equal(vesselDisplayName(vessel), "MV EKO ATLANTIC");
  assert.equal(vesselKey(vessel), "mmsi:657123400");
  assert.ok(!isUnmatchedTrack(vessel));
});

test("vessel summary fails closed on floating-point or out-of-range coordinates", () => {
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, latitudeMicros: 6.45 }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, latitudeMicros: 91_000_000 }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, longitudeMicros: -181_000_000 }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, speedOverGroundMilliknots: -3 }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, courseOverGroundMillidegrees: 360_000 }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, sourceClass: "unknown" }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, classification: "EYES ONLY" }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, mmsi: "12345" }), null);
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, observedAt: "not-a-date" }), null);
  assert.equal(parseVesselSummary("vessel"), null);
  assert.equal(parseVesselSummary(null), null);
});

test("empty MMSI is lawful only for APP_REPORT and marks an unmatched/dark track", () => {
  const appReport = parseVesselSummary({ ...VALID_VESSEL, mmsi: "", sourceClass: "APP_REPORT", shipName: undefined });
  assert.ok(appReport !== null);
  assert.ok(isUnmatchedTrack(appReport));
  // An AIS record without an MMSI binding is a contract violation.
  assert.equal(parseVesselSummary({ ...VALID_VESSEL, mmsi: "" }), null);
});

test("staleness threshold flags positions older than 30 minutes", () => {
  const vessel = parseVesselSummary(VALID_VESSEL);
  assert.ok(vessel !== null);
  const observed = Date.parse(vessel.observedAt);
  assert.ok(!isStalePosition(vessel, observed + 10 * 60_000));
  assert.ok(isStalePosition(vessel, observed + 31 * 60_000));
});

test("SOS visibility gate requires the role AND RESTRICTED clearance", () => {
  assert.ok(canReadSOS(new Set(["geo-sos-reader"]), "RESTRICTED"));
  assert.ok(canReadSOS(new Set(["geo-admin"]), "SECRET"));
  // Role without clearance, clearance without role, and neither all fail.
  assert.ok(!canReadSOS(new Set(["geo-sos-reader"]), "INTERNAL"));
  assert.ok(!canReadSOS(new Set(["geo-sos-reader"]), null));
  assert.ok(!canReadSOS(new Set(["geo-reader"]), "SECRET"));
  assert.ok(!canReadSOS(new Set(), "PUBLIC"));
  assert.ok(isGeoReader(new Set(["geo-reader"])));
  assert.ok(isGeoReader(new Set(["geo-zone-checker"])));
  assert.ok(!isGeoReader(new Set(["nimasa-officer"])));
});

test("SOS alerts enforce the RESTRICTED contract floor on parse", () => {
  const base = {
    sosAlertId: "sos-1",
    reporterId: "reporter-7",
    vesselReference: "vr-9f2",
    latitudeMicros: 6_100_000,
    longitudeMicros: 3_200_000,
    recordedAt: "2026-08-29T02:00:00Z",
    classification: "RESTRICTED",
    state: "RAISED",
    receivedAt: "2026-08-29T02:00:04Z",
  };
  const alert = parseSOSAlert(base);
  assert.ok(alert !== null);
  assert.equal(alert.state, "RAISED");
  // The contract floor: consumers fail closed below RESTRICTED.
  assert.equal(parseSOSAlert({ ...base, classification: "INTERNAL" }), null);
  assert.equal(parseSOSAlert({ ...base, classification: "PUBLIC" }), null);
  assert.equal(parseSOSAlert({ ...base, state: "PENDING" }), null);
  assert.equal(parseSOSAlert({ ...base, latitudeMicros: 6.1 }), null);
});

test("bbox helpers serialise degree bounds to micro-degree query strings", () => {
  const bbox = bboxFromDegrees(-2.0, 2.5, 15.5, 14.5);
  assert.ok(bbox !== null);
  assert.equal(bboxToQuery(bbox), "-2000000,2500000,15500000,14500000");
  // Inverted or out-of-range bounds are refused.
  assert.equal(bboxFromDegrees(10, 0, 5, 10), null);
  assert.equal(bboxFromDegrees(0, -95, 10, 0), null);
  assert.equal(bboxFromDegrees(Number.NaN, 0, 10, 10), null);
});

test("track GeoJSON validates degree LineStrings and rejects bad geometry", () => {
  const line = parseTrackLineString({ type: "LineString", coordinates: [[3.4, 6.4], [3.5, 6.45]] });
  assert.deepEqual(line, [[3.4, 6.4], [3.5, 6.45]]);
  assert.deepEqual(parseTrackLineString({ type: "LineString", coordinates: [] }), []);
  assert.equal(parseTrackLineString({ type: "Point", coordinates: [3.4, 6.4] }), null);
  assert.equal(parseTrackLineString({ type: "LineString", coordinates: [[181, 0]] }), null);
  assert.equal(parseTrackLineString({ type: "LineString", coordinates: [[3.4, "6.4"]] }), null);
});

test("geofence polygon strings validate and return the outer ring", () => {
  const ring = parseGeoJsonPolygon(JSON.stringify({ type: "Polygon", coordinates: [[[2, 4], [8, 4], [8, 10], [2, 10], [2, 4]]] }));
  assert.ok(ring !== null);
  assert.equal(ring.length, 5);
  assert.equal(parseGeoJsonPolygon("not json"), null);
  assert.equal(parseGeoJsonPolygon(JSON.stringify({ type: "Point", coordinates: [2, 4] })), null);
  assert.equal(parseGeoJsonPolygon(JSON.stringify({ type: "Polygon", coordinates: [[[2, 4], [200, 4], [2, 4], [2, 4]]] })), null);
});
