import assert from "node:assert/strict";
import test from "node:test";

import {
  caseStatus,
  parseSarCase,
  parseSarSitrep,
  parseSarTasking,
  parseSarTimelineEntry,
  parseYaoundeRelease,
  regionOfCase,
  type SarCase,
} from "../src/sar/sar-model.ts";

// Contract-aligned payloads mirroring blueeconomy-maritime-intelligence
// internal/sar/model.go and the maritime.sar.v1 / maritime.yaounde.v1 event
// resources (blueeconomy-contracts fixtures/sar, fixtures/yaounde).
const CASE = {
  case_id: "sar-000001",
  incident_id: "inc-000502",
  phase: "INCERFA",
  stage: "AWARENESS",
  classification: "RESTRICTED",
  intake_kind: "GEO_SOS",
  source_ref: "sos-000118",
  persons_at_risk: 3,
  last_known_lat: 6.1201,
  last_known_lon: 3.4467,
  last_known_at: "2026-08-29T12:05:21Z",
  created_by: "watchkeeper-7",
  created_at: "2026-08-29T12:14:02Z",
  updated_at: "2026-08-29T12:14:02Z",
  version: 1,
};

test("parseSarCase accepts a full observed case record", () => {
  const parsed = parseSarCase(CASE);
  assert.ok(parsed !== null);
  assert.equal(parsed.case_id, "sar-000001");
  assert.equal(parsed.phase, "INCERFA");
  assert.equal(parsed.stage, "AWARENESS");
  assert.equal(parsed.intake_kind, "GEO_SOS");
  assert.equal(parsed.persons_at_risk, 3);
  assert.equal(parsed.last_known_lat, 6.1201);
  assert.equal(parsed.stand_down_reason, null);
  assert.equal(caseStatus(parsed), "open");
});

test("parseSarCase rejects unknown enum values and malformed timestamps fail-closed", () => {
  assert.equal(parseSarCase({ ...CASE, phase: "MAYDAY" }), null);
  assert.equal(parseSarCase({ ...CASE, stage: "CLOSED" }), null);
  assert.equal(parseSarCase({ ...CASE, intake_kind: "TELEPHONE" }), null);
  assert.equal(parseSarCase({ ...CASE, created_at: "not-a-time" }), null);
  assert.equal(parseSarCase({ ...CASE, version: "1" }), null);
  assert.equal(parseSarCase({ ...CASE, case_id: "" }), null);
  assert.equal(parseSarCase("sar-000001"), null);
});

test("a STAND_DOWN case with a recorded reason derives closed status", () => {
  const parsed = parseSarCase({ ...CASE, stage: "STAND_DOWN", stand_down_reason: "RESOLVED", persons_recovered: 3 });
  assert.ok(parsed !== null);
  assert.equal(caseStatus(parsed), "closed");
  assert.equal(parsed.stand_down_reason, "RESOLVED");
  assert.equal(parsed.persons_recovered, 3);
});

test("parseSarTimelineEntry keeps unknown future entry types but requires the envelope fields", () => {
  const entry = parseSarTimelineEntry({
    entry_id: "tle-1",
    case_id: "sar-000001",
    entry_type: "sitrep.issued",
    actor: "coordinator-2",
    detail: { sequence: 1 },
    created_at: "2026-08-29T14:00:00Z",
  });
  assert.ok(entry !== null);
  assert.equal(entry.entry_type, "sitrep.issued");
  const future = parseSarTimelineEntry({ entry_id: "tle-2", case_id: "sar-000001", entry_type: "helicopter.launched", actor: "", detail: {}, created_at: "2026-08-29T15:00:00Z" });
  assert.ok(future !== null);
  assert.equal(parseSarTimelineEntry({ entry_id: "tle-3", case_id: "sar-000001", entry_type: "stage.changed", created_at: "soon" }), null);
});

test("parseSarTasking enforces the tasking lifecycle vocabulary", () => {
  const tasking = parseSarTasking({
    tasking_id: "tsk-000001",
    case_id: "sar-000001",
    resource_id: "sru-db-07",
    task: "SEARCH_PATTERN",
    state: "TASKED",
    tasked_by: "coordinator-2",
    created_at: "2026-08-29T13:31:56Z",
    updated_at: "2026-08-29T13:31:56Z",
    version: 2,
  });
  assert.ok(tasking !== null);
  assert.equal(tasking.state, "TASKED");
  assert.equal(parseSarTasking({ tasking_id: "tsk-1", case_id: "c", resource_id: "r", task: "FISH", state: "TASKED", tasked_by: "x", created_at: "2026-08-29T13:31:56Z", updated_at: "2026-08-29T13:31:56Z", version: 1 }), null);
  assert.equal(parseSarTasking({ tasking_id: "tsk-1", case_id: "c", resource_id: "r", task: "RESCUE", state: "DONE", tasked_by: "x", created_at: "2026-08-29T13:31:56Z", updated_at: "2026-08-29T13:31:56Z", version: 1 }), null);
});

test("parseSarSitrep requires a positive sequence and a digest", () => {
  const sitrep = parseSarSitrep({
    sitrep_id: "sitrep-000001",
    case_id: "sar-000001",
    sequence: 1,
    body: { phase: "ALERFA", stage: "INITIAL_ACTION" },
    body_sha256: "sha256:d84d9ec6",
    envelope_jws: "eyJ...",
    issued_by: "coordinator-2",
    issued_at: "2026-08-29T14:00:00Z",
  });
  assert.ok(sitrep !== null);
  assert.equal(sitrep.sequence, 1);
  assert.equal(parseSarSitrep({ ...sitrep, sequence: 0 }), null);
  assert.equal(parseSarSitrep({ ...sitrep, body_sha256: "" }), null);
});

test("parseYaoundeRelease enforces marking/state vocabulary for cross-links", () => {
  const release = parseYaoundeRelease({
    release_id: "ygr-000001",
    incident_id: "inc-000502",
    peer_id: "peer-mmcc-zone-e",
    marking: "YAOUNDE_ZONE_E",
    classification: "RESTRICTED",
    report_sha256: "sha256:bca51792505d",
    state: "DISPATCHED",
    created_at: "2026-08-28T03:00:00Z",
    updated_at: "2026-08-28T03:05:00Z",
    version: 3,
  });
  assert.ok(release !== null);
  assert.equal(release.marking, "YAOUNDE_ZONE_E");
  assert.equal(parseYaoundeRelease({ ...release, marking: "WORLD_READABLE" }), null);
  assert.equal(parseYaoundeRelease({ ...release, state: "SEEN" }), null);
});

test("regionOfCase derives regions only from recorded positions", () => {
  const base = parseSarCase(CASE);
  assert.ok(base !== null);
  const gulf: SarCase = { ...base, last_known_lat: 6.1201, last_known_lon: 3.4467 };
  assert.equal(regionOfCase(gulf).id, "gulf-of-guinea");
  const noPosition: SarCase = { ...base, last_known_lat: null, last_known_lon: null, datum_lat: null, datum_lon: null };
  assert.equal(regionOfCase(noPosition).id, "no-position");
  const far: SarCase = { ...base, last_known_lat: 55, last_known_lon: 10 };
  assert.equal(regionOfCase(far).id, "outside-regions");
  const datumOnly: SarCase = { ...base, last_known_lat: null, last_known_lon: null, datum_lat: 4.0, datum_lon: 8.0 };
  assert.equal(regionOfCase(datumOnly).id, "gulf-of-guinea");
});
