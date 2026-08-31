// sar-model holds the typed, fail-closed model for the SAR C2 console. The
// shapes mirror blueeconomy-maritime-intelligence internal/sar/model.go and
// internal/yaounde/model.go exactly (the read verbs under /v1/sar/* and
// /v1/yaounde/releases). Every parser validates the observed payload and
// returns null for a record that does not match the contract, so a
// malformed record is dropped and counted rather than rendered as truth.
//
// The SAR case lifecycle follows the maritime.sar.v1 event contracts
// (blueeconomy-contracts docs/sar-events.md): IAMSAR phases
// INCERFA/ALERFA/DETRESFA and stages AWARENESS → INITIAL_ACTION →
// COORDINATION → STAND_DOWN, with tasking orders, numbered SITREPs and a
// recorded stand-down closure.

export const SAR_PHASES = ["INCERFA", "ALERFA", "DETRESFA"] as const;
export type SarPhase = (typeof SAR_PHASES)[number];

export const SAR_STAGES = ["AWARENESS", "INITIAL_ACTION", "COORDINATION", "STAND_DOWN"] as const;
export type SarStage = (typeof SAR_STAGES)[number];

export const SAR_INTAKE_KINDS = ["WATERWAY_EVENT", "GEO_SOS", "MANUAL"] as const;
export type SarIntakeKind = (typeof SAR_INTAKE_KINDS)[number];

export const SAR_STAND_DOWN_REASONS = ["RESOLVED", "SUSPENDED", "FALSE_ALERT", "HANDED_OVER"] as const;
export type SarStandDownReason = (typeof SAR_STAND_DOWN_REASONS)[number];

export const SAR_TASKING_STATES = ["PROPOSED", "TASKED", "ACKED", "ON_SCENE", "RELEASED", "ABORTED"] as const;
export type SarTaskingState = (typeof SAR_TASKING_STATES)[number];

export const SAR_RESOURCE_KINDS = ["VESSEL", "AIRCRAFT", "TEAM", "VOO"] as const;
export type SarResourceKind = (typeof SAR_RESOURCE_KINDS)[number];

export const SAR_RESOURCE_STATUSES = ["AVAILABLE", "TASKED", "OFFLINE"] as const;
export type SarResourceStatus = (typeof SAR_RESOURCE_STATUSES)[number];

export const SAR_TASKS = ["SEARCH_PATTERN", "INVESTIGATE", "RESCUE", "RELAY", "MEDEVAC", "OTHER"] as const;
export type SarTask = (typeof SAR_TASKS)[number];

// Timeline entry types recorded by the SAR store (internal/sar/model.go
// Entry* constants); the console renders unknown future types truthfully
// with their raw type label rather than dropping them.
export const SAR_TIMELINE_ENTRY_TYPES = [
  "case.opened",
  "phase.changed",
  "stage.changed",
  "datum.set",
  "tasking.proposed",
  "tasking.tasked",
  "tasking.acked",
  "tasking.on_scene",
  "tasking.released",
  "tasking.aborted",
  "sitrep.issued",
  "case.intake_linked",
  "sos.acknowledged",
  "sos.resolved",
  "resource.registered",
  "resource.status_changed",
] as const;
export type SarTimelineEntryType = (typeof SAR_TIMELINE_ENTRY_TYPES)[number];

export const YAOUNDE_RELEASE_STATES = ["DRAFT", "APPROVED", "DISPATCHED", "ACKNOWLEDGED", "FAILED", "WITHDRAWN"] as const;
export type YaoundeReleaseState = (typeof YAOUNDE_RELEASE_STATES)[number];

export const YAOUNDE_MARKINGS = ["NATIONAL_ONLY", "YAOUNDE_ZONE_E", "YAOUNDE_REGIONAL", "MDAT_GOG_SHAREABLE"] as const;
export type YaoundeMarking = (typeof YAOUNDE_MARKINGS)[number];

export interface SarCase {
  case_id: string;
  incident_id: string;
  phase: SarPhase;
  stage: SarStage;
  classification: string;
  intake_kind: SarIntakeKind;
  source_ref: string;
  persons_at_risk: number | null;
  last_known_lat: number | null;
  last_known_lon: number | null;
  last_known_at: string | null;
  datum_lat: number | null;
  datum_lon: number | null;
  datum_at: string | null;
  datum_evidence_sha256: string | null;
  stand_down_reason: SarStandDownReason | null;
  persons_recovered: number | null;
  handover_ref: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface SarTimelineEntry {
  entry_id: string;
  case_id: string;
  entry_type: string;
  actor: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface SarTasking {
  tasking_id: string;
  case_id: string;
  resource_id: string;
  task: SarTask;
  state: SarTaskingState;
  tasked_by: string;
  acked_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface SarSitrep {
  sitrep_id: string;
  case_id: string;
  sequence: number;
  body: Record<string, unknown>;
  body_sha256: string;
  envelope_jws: string;
  issued_by: string;
  issued_at: string;
}

export interface SarResource {
  resource_id: string;
  kind: SarResourceKind;
  callsign: string;
  home_authority: string;
  status: SarResourceStatus;
  registered_by: string;
  created_at: string;
  updated_at: string;
}

// YaoundeRelease is the outbound regional incident-report release record
// (internal/yaounde/model.go Release). The SAR console cross-links a case to
// the releases recorded against the same incident reference.
export interface YaoundeRelease {
  release_id: string;
  incident_id: string;
  peer_id: string;
  marking: YaoundeMarking;
  classification: string;
  report_sha256: string;
  state: YaoundeReleaseState;
  released_by: string | null;
  approved_by: string | null;
  dispatched_at: string | null;
  acked_at: string | null;
  ack_receipt_sha256: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

// caseStatus derives the two-state operator view from the observed stage:
// a case at STAND_DOWN is closed (the event stream's case_closed fact);
// every earlier stage is open. Nothing else is inferred.
export function caseStatus(sarCase: SarCase): "open" | "closed" {
  return sarCase.stage === "STAND_DOWN" ? "closed" : "open";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalIsoInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : value;
}

function requiredIsoInstant(value: unknown): string | null {
  return optionalIsoInstant(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseSarCase(candidate: unknown): SarCase | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const caseId = requiredText(candidate.case_id);
  const incidentId = requiredText(candidate.incident_id);
  const phase = oneOf(candidate.phase, SAR_PHASES);
  const stage = oneOf(candidate.stage, SAR_STAGES);
  const classification = requiredText(candidate.classification);
  const intakeKind = oneOf(candidate.intake_kind, SAR_INTAKE_KINDS);
  const createdBy = requiredText(candidate.created_by);
  const createdAt = requiredIsoInstant(candidate.created_at);
  const updatedAt = requiredIsoInstant(candidate.updated_at);
  const version = requiredInteger(candidate.version);
  if (caseId === null || incidentId === null || phase === null || stage === null || classification === null || intakeKind === null || createdBy === null || createdAt === null || updatedAt === null || version === null) {
    return null;
  }
  const standDown = candidate.stand_down_reason === undefined ? null : oneOf(candidate.stand_down_reason, SAR_STAND_DOWN_REASONS);
  return {
    case_id: caseId,
    incident_id: incidentId,
    phase,
    stage,
    classification,
    intake_kind: intakeKind,
    source_ref: optionalText(candidate.source_ref) ?? "",
    persons_at_risk: candidate.persons_at_risk === undefined ? null : optionalInteger(candidate.persons_at_risk),
    last_known_lat: candidate.last_known_lat === undefined ? null : optionalFiniteNumber(candidate.last_known_lat),
    last_known_lon: candidate.last_known_lon === undefined ? null : optionalFiniteNumber(candidate.last_known_lon),
    last_known_at: candidate.last_known_at === undefined ? null : optionalIsoInstant(candidate.last_known_at),
    datum_lat: candidate.datum_lat === undefined ? null : optionalFiniteNumber(candidate.datum_lat),
    datum_lon: candidate.datum_lon === undefined ? null : optionalFiniteNumber(candidate.datum_lon),
    datum_at: candidate.datum_at === undefined ? null : optionalIsoInstant(candidate.datum_at),
    datum_evidence_sha256: candidate.datum_evidence_sha256 === undefined ? null : optionalText(candidate.datum_evidence_sha256),
    stand_down_reason: standDown,
    persons_recovered: candidate.persons_recovered === undefined ? null : optionalInteger(candidate.persons_recovered),
    handover_ref: candidate.handover_ref === undefined ? null : optionalText(candidate.handover_ref),
    created_by: createdBy,
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  };
}

export function parseSarTimelineEntry(candidate: unknown): SarTimelineEntry | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const entryId = requiredText(candidate.entry_id);
  const caseId = requiredText(candidate.case_id);
  const entryType = requiredText(candidate.entry_type);
  const createdAt = requiredIsoInstant(candidate.created_at);
  if (entryId === null || caseId === null || entryType === null || createdAt === null) {
    return null;
  }
  return {
    entry_id: entryId,
    case_id: caseId,
    entry_type: entryType,
    actor: optionalText(candidate.actor) ?? "",
    detail: isRecord(candidate.detail) ? candidate.detail : {},
    created_at: createdAt,
  };
}

export function parseSarTasking(candidate: unknown): SarTasking | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const taskingId = requiredText(candidate.tasking_id);
  const caseId = requiredText(candidate.case_id);
  const resourceId = requiredText(candidate.resource_id);
  const task = oneOf(candidate.task, SAR_TASKS);
  const state = oneOf(candidate.state, SAR_TASKING_STATES);
  const taskedBy = requiredText(candidate.tasked_by);
  const createdAt = requiredIsoInstant(candidate.created_at);
  const updatedAt = requiredIsoInstant(candidate.updated_at);
  const version = requiredInteger(candidate.version);
  if (taskingId === null || caseId === null || resourceId === null || task === null || state === null || taskedBy === null || createdAt === null || updatedAt === null || version === null) {
    return null;
  }
  return {
    tasking_id: taskingId,
    case_id: caseId,
    resource_id: resourceId,
    task,
    state,
    tasked_by: taskedBy,
    acked_by: candidate.acked_by === undefined ? null : optionalText(candidate.acked_by),
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  };
}

export function parseSarSitrep(candidate: unknown): SarSitrep | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const sitrepId = requiredText(candidate.sitrep_id);
  const caseId = requiredText(candidate.case_id);
  const sequence = requiredInteger(candidate.sequence);
  const bodySha256 = requiredText(candidate.body_sha256);
  const issuedBy = requiredText(candidate.issued_by);
  const issuedAt = requiredIsoInstant(candidate.issued_at);
  if (sitrepId === null || caseId === null || sequence === null || sequence < 1 || bodySha256 === null || issuedBy === null || issuedAt === null) {
    return null;
  }
  return {
    sitrep_id: sitrepId,
    case_id: caseId,
    sequence,
    body: isRecord(candidate.body) ? candidate.body : {},
    body_sha256: bodySha256,
    envelope_jws: optionalText(candidate.envelope_jws) ?? "",
    issued_by: issuedBy,
    issued_at: issuedAt,
  };
}

export function parseSarResource(candidate: unknown): SarResource | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const resourceId = requiredText(candidate.resource_id);
  const kind = oneOf(candidate.kind, SAR_RESOURCE_KINDS);
  const callsign = requiredText(candidate.callsign);
  const status = oneOf(candidate.status, SAR_RESOURCE_STATUSES);
  const registeredBy = requiredText(candidate.registered_by);
  const createdAt = requiredIsoInstant(candidate.created_at);
  const updatedAt = requiredIsoInstant(candidate.updated_at);
  if (resourceId === null || kind === null || callsign === null || status === null || registeredBy === null || createdAt === null || updatedAt === null) {
    return null;
  }
  return {
    resource_id: resourceId,
    kind,
    callsign,
    home_authority: optionalText(candidate.home_authority) ?? "",
    status,
    registered_by: registeredBy,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function parseYaoundeRelease(candidate: unknown): YaoundeRelease | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const releaseId = requiredText(candidate.release_id);
  const incidentId = requiredText(candidate.incident_id);
  const peerId = requiredText(candidate.peer_id);
  const marking = oneOf(candidate.marking, YAOUNDE_MARKINGS);
  const classification = requiredText(candidate.classification);
  const reportSha256 = requiredText(candidate.report_sha256);
  const state = oneOf(candidate.state, YAOUNDE_RELEASE_STATES);
  const createdAt = requiredIsoInstant(candidate.created_at);
  const updatedAt = requiredIsoInstant(candidate.updated_at);
  const version = requiredInteger(candidate.version);
  if (releaseId === null || incidentId === null || peerId === null || marking === null || classification === null || reportSha256 === null || state === null || createdAt === null || updatedAt === null || version === null) {
    return null;
  }
  return {
    release_id: releaseId,
    incident_id: incidentId,
    peer_id: peerId,
    marking,
    classification,
    report_sha256: reportSha256,
    state,
    released_by: candidate.released_by === undefined ? null : optionalText(candidate.released_by),
    approved_by: candidate.approved_by === undefined ? null : optionalText(candidate.approved_by),
    dispatched_at: candidate.dispatched_at === undefined ? null : optionalIsoInstant(candidate.dispatched_at),
    acked_at: candidate.acked_at === undefined ? null : optionalIsoInstant(candidate.acked_at),
    ack_receipt_sha256: candidate.ack_receipt_sha256 === undefined ? null : optionalText(candidate.ack_receipt_sha256),
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  };
}

// ---------------------------------------------------------------------------
// Operational region derivation
// ---------------------------------------------------------------------------

// SAR_REGIONS names the operational waters the Ministry console groups by.
// Region membership is derived deterministically from the case's observed
// last-known position (or datum when no last-known position exists); it is
// a view transform of recorded coordinates, never an asserted fact. Cases
// without a recorded position are grouped under "no-position" and stay
// visible so the filter can never hide a case silently.
export interface SarRegion {
  id: string;
  label: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const SAR_REGIONS: readonly SarRegion[] = [
  { id: "gulf-of-guinea", label: "Gulf of Guinea", minLat: -6, maxLat: 6.5, minLon: -10, maxLon: 12 },
  { id: "west-africa-north", label: "West Africa (north of Gulf of Guinea)", minLat: 6.5, maxLat: 28, minLon: -20, maxLon: 16 },
  { id: "south-atlantic", label: "South Atlantic approaches", minLat: -35, maxLat: -6, minLon: -20, maxLon: 16 },
];

export type SarRegionFilter = "all" | "no-position" | "outside-regions" | string;

export interface RegionAssignment {
  id: string;
  label: string;
}

// regionOfCase assigns a case to exactly one region from its recorded
// position (last-known preferred, datum otherwise). The assignment is
// derived, not stored: the UI labels it as such.
export function regionOfCase(sarCase: SarCase): RegionAssignment {
  const lat = sarCase.last_known_lat ?? sarCase.datum_lat;
  const lon = sarCase.last_known_lon ?? sarCase.datum_lon;
  if (lat === null || lon === null) {
    return { id: "no-position", label: "No recorded position" };
  }
  for (const region of SAR_REGIONS) {
    if (lat >= region.minLat && lat <= region.maxLat && lon >= region.minLon && lon <= region.maxLon) {
      return { id: region.id, label: region.label };
    }
  }
  return { id: "outside-regions", label: "Outside named regions" };
}
