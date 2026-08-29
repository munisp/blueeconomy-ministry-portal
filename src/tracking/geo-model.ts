// geo-model is the fail-closed domain model for the #/tracking console. It
// mirrors the blueeconomy-geo-service /v1/geo wire shapes (openapi.yaml) and
// the geo.*.v1 contract semantics (contracts docs/geo-events.md): all
// coordinates are fixed-point micro-degrees, speeds are milli-knots and
// courses are milli-degrees; floating-point coordinates are prohibited on
// the wire. Every parser here validates the shape and returns null rather
// than coercing, so a malformed payload degrades the console honestly
// instead of fabricating a vessel.

export const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL", "SECRET"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

// parseClassification accepts only the canonical ladder labels (the
// geo-service clearance ladder PUBLIC..SECRET); anything else is refused.
export function parseClassification(value: unknown): Classification | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return (CLASSIFICATIONS as readonly string[]).includes(normalized) ? (normalized as Classification) : null;
}

export function classificationRank(label: Classification): number {
  return CLASSIFICATIONS.indexOf(label);
}

// classificationCovers implements the clearance ladder: a reader at
// `clearance` may see rows classified `row`.
export function classificationCovers(clearance: Classification, row: Classification): boolean {
  return classificationRank(clearance) >= classificationRank(row);
}

export const POSITION_SOURCE_CLASSES = ["AIS", "GSM_TRACKER", "SAT_TRACKER", "APP_REPORT"] as const;
export type PositionSourceClass = (typeof POSITION_SOURCE_CLASSES)[number];

// parseSourceClass enforces the fail-closed PositionSourceClass taxonomy;
// free-text source values are prohibited by the contract.
export function parseSourceClass(value: unknown): PositionSourceClass | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return (POSITION_SOURCE_CLASSES as readonly string[]).includes(normalized) ? (normalized as PositionSourceClass) : null;
}

// sourceClassBadge is the short console badge per source tier.
export function sourceClassBadge(sourceClass: PositionSourceClass): string {
  switch (sourceClass) {
    case "AIS":
      return "AIS";
    case "GSM_TRACKER":
      return "GSM";
    case "SAT_TRACKER":
      return "SAT";
    case "APP_REPORT":
      return "APP";
  }
}

export function sourceClassLabel(sourceClass: PositionSourceClass): string {
  switch (sourceClass) {
    case "AIS":
      return "AIS receiver network";
    case "GSM_TRACKER":
      return "GSM/GPRS tracker";
    case "SAT_TRACKER":
      return "Satellite tracker";
    case "APP_REPORT":
      return "Mobile app report (Tier-0)";
  }
}

// Fixed-point conversion helpers (contract field conventions). Inputs must
// be integers inside the documented ranges; violations return null so the
// caller can drop the record instead of plotting a wrong position.
export const MICROS_PER_DEGREE = 1_000_000;
export const LATITUDE_MICROS_MIN = -90_000_000;
export const LATITUDE_MICROS_MAX = 90_000_000;
export const LONGITUDE_MICROS_MIN = -180_000_000;
export const LONGITUDE_MICROS_MAX = 180_000_000;

export function microsToDegrees(micros: number, min: number, max: number): number | null {
  if (!Number.isInteger(micros) || micros < min || micros > max) {
    return null;
  }
  return micros / MICROS_PER_DEGREE;
}

export function latitudeMicrosToDegrees(micros: number): number | null {
  return microsToDegrees(micros, LATITUDE_MICROS_MIN, LATITUDE_MICROS_MAX);
}

export function longitudeMicrosToDegrees(micros: number): number | null {
  return microsToDegrees(micros, LONGITUDE_MICROS_MIN, LONGITUDE_MICROS_MAX);
}

export function degreesToMicros(degrees: number): number | null {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) {
    return null;
  }
  return Math.round(degrees * MICROS_PER_DEGREE);
}

// milliknotsToKnots converts speed_over_ground_milliknots; negative speeds
// are impossible on the wire and rejected.
export function milliknotsToKnots(milliknots: number): number | null {
  if (!Number.isInteger(milliknots) || milliknots < 0) {
    return null;
  }
  return milliknots / 1_000;
}

// millidegreesToDegrees converts course_over_ground_millidegrees; a course
// is a heading in [0, 360).
export function millidegreesToDegrees(millidegrees: number): number | null {
  if (!Number.isInteger(millidegrees) || millidegrees < 0 || millidegrees >= 360_000) {
    return null;
  }
  return millidegrees / 1_000;
}

export function formatSpeedKnots(milliknots: number): string {
  const knots = milliknotsToKnots(milliknots);
  return knots === null ? "not reported" : `${knots.toFixed(1)} kn`;
}

export function formatCourseDegrees(millidegrees: number): string {
  const degrees = millidegreesToDegrees(millidegrees);
  if (degrees === null) {
    return "not reported";
  }
  return `${Math.round(degrees).toString().padStart(3, "0")}°`;
}

export function formatDegrees(degrees: number, positiveSuffix: string, negativeSuffix: string): string {
  const absolute = Math.abs(degrees);
  return `${absolute.toFixed(4)}° ${degrees >= 0 ? positiveSuffix : negativeSuffix}`;
}

// VesselSummary mirrors the openapi VesselSummary schema exactly (camelCase
// JSON, fixed-point integers).
export interface VesselSummary {
  mmsi: string;
  vesselRef?: string;
  sourceClass: PositionSourceClass;
  latitudeMicros: number;
  longitudeMicros: number;
  speedOverGroundMilliknots: number;
  courseOverGroundMillidegrees: number;
  classification: Classification;
  observedAt: string;
  shipName?: string;
  shipTypeCode?: number;
}

const MMSI_PATTERN = /^[0-9]{9}$/;

export function isValidMmsi(value: string): boolean {
  return MMSI_PATTERN.test(value);
}

// parseVesselSummary validates one wire record fail-closed: mmsi is 9 digits
// or (APP_REPORT only, per the contract) empty; every fixed-point field must
// be an integer inside its contract range; enums must be canonical.
export function parseVesselSummary(value: unknown): VesselSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.mmsi !== "string") {
    return null;
  }
  const mmsi = value.mmsi.trim();
  const sourceClass = parseSourceClass(value.sourceClass);
  if (sourceClass === null) {
    return null;
  }
  // mmsi is optional only on APP_REPORT reports (contract field conventions).
  if (mmsi !== "" && !MMSI_PATTERN.test(mmsi)) {
    return null;
  }
  if (mmsi === "" && sourceClass !== "APP_REPORT") {
    return null;
  }
  if (typeof value.latitudeMicros !== "number" || latitudeMicrosToDegrees(value.latitudeMicros) === null) {
    return null;
  }
  if (typeof value.longitudeMicros !== "number" || longitudeMicrosToDegrees(value.longitudeMicros) === null) {
    return null;
  }
  if (typeof value.speedOverGroundMilliknots !== "number" || milliknotsToKnots(value.speedOverGroundMilliknots) === null) {
    return null;
  }
  if (typeof value.courseOverGroundMillidegrees !== "number" || millidegreesToDegrees(value.courseOverGroundMillidegrees) === null) {
    return null;
  }
  const classification = parseClassification(value.classification);
  if (classification === null) {
    return null;
  }
  if (typeof value.observedAt !== "string" || Number.isNaN(Date.parse(value.observedAt))) {
    return null;
  }
  const summary: VesselSummary = {
    mmsi,
    sourceClass,
    latitudeMicros: value.latitudeMicros,
    longitudeMicros: value.longitudeMicros,
    speedOverGroundMilliknots: value.speedOverGroundMilliknots,
    courseOverGroundMillidegrees: value.courseOverGroundMillidegrees,
    classification,
    observedAt: value.observedAt,
  };
  if (typeof value.vesselRef === "string" && value.vesselRef.trim().length > 0) {
    summary.vesselRef = value.vesselRef.trim();
  }
  if (typeof value.shipName === "string" && value.shipName.trim().length > 0) {
    summary.shipName = value.shipName.trim();
  }
  if (typeof value.shipTypeCode === "number" && Number.isInteger(value.shipTypeCode)) {
    summary.shipTypeCode = value.shipTypeCode;
  }
  return summary;
}

// vesselDisplayName picks the most truthful label available without
// inventing one.
export function vesselDisplayName(vessel: VesselSummary): string {
  if (vessel.shipName !== undefined) {
    return vessel.shipName;
  }
  if (vessel.mmsi !== "") {
    return `MMSI ${vessel.mmsi}`;
  }
  return vessel.vesselRef !== undefined ? `Report ${vessel.vesselRef}` : "Unmatched report";
}

// isUnmatchedTrack marks dark-vessel / unmatched-track records: a position
// with no MMSI binding (only lawful for APP_REPORT per the contract). These
// render with the distinct unmatched style, never merged into a track.
export function isUnmatchedTrack(vessel: VesselSummary): boolean {
  return vessel.mmsi === "";
}

// vesselKey is the stable identity used for map entity bookkeeping.
export function vesselKey(vessel: VesselSummary): string {
  return vessel.mmsi !== "" ? `mmsi:${vessel.mmsi}` : `ref:${vessel.vesselRef ?? vessel.observedAt}`;
}

// POSITION_STALE_THRESHOLD_MS marks positions older than 30 minutes as
// stale: they stay on the map (they are real observations) but render
// dimmed with an explicit staleness note.
export const POSITION_STALE_THRESHOLD_MS = 30 * 60 * 1_000;

export function isStalePosition(vessel: VesselSummary, nowMs: number, thresholdMs: number = POSITION_STALE_THRESHOLD_MS): boolean {
  const observedMs = Date.parse(vessel.observedAt);
  return nowMs - observedMs > thresholdMs;
}

// vesselLatitude / vesselLongitude unwrap the validated fixed-point fields;
// parsers guarantee non-null, so the fallback branch is unreachable by
// construction but stays honest if a caller bypasses the parser.
export function vesselLatitude(vessel: VesselSummary): number {
  return latitudeMicrosToDegrees(vessel.latitudeMicros) ?? 0;
}

export function vesselLongitude(vessel: VesselSummary): number {
  return longitudeMicrosToDegrees(vessel.longitudeMicros) ?? 0;
}

// Zone mirrors the openapi Zone schema; geoJson carries the polygon as a
// GeoJSON string.
export interface GeoZone {
  zoneId: string;
  name: string;
  classificationFloor: Classification;
  state: "draft" | "approved";
  polygon: [number, number][] | null;
}

export function parseZone(value: unknown): GeoZone | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.zoneId !== "string" || value.zoneId.trim().length === 0) {
    return null;
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return null;
  }
  const floor = parseClassification(value.classificationFloor);
  if (floor === null) {
    return null;
  }
  if (value.state !== "draft" && value.state !== "approved") {
    return null;
  }
  let polygon: [number, number][] | null = null;
  if (typeof value.geoJson === "string" && value.geoJson.length > 0) {
    polygon = parseGeoJsonPolygon(value.geoJson);
    if (polygon === null) {
      // A zone whose geometry cannot be validated is never drawn.
      return null;
    }
  }
  return { zoneId: value.zoneId.trim(), name: value.name.trim(), classificationFloor: floor, state: value.state, polygon };
}

// parseGeoJsonPolygon validates a GeoJSON Polygon string and returns the
// outer ring as [lon, lat] degree pairs (GeoJSON is degrees on the wire,
// unlike the fixed-point position fields).
export function parseGeoJsonPolygon(raw: string): [number, number][] | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(candidate) || candidate.type !== "Polygon" || !Array.isArray(candidate.coordinates)) {
    return null;
  }
  const outer = candidate.coordinates[0];
  if (!Array.isArray(outer) || outer.length < 4) {
    return null;
  }
  const ring: [number, number][] = [];
  for (const point of outer) {
    if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== "number" || typeof point[1] !== "number") {
      return null;
    }
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return null;
    }
    ring.push([lon, lat]);
  }
  return ring;
}

// TrackPoint is one validated vertex of the GeoJSON LineString returned by
// GET /vessels/{mmsi}/track (degrees on the wire).
export function parseTrackLineString(value: unknown): [number, number][] | null {
  if (!isRecord(value) || value.type !== "LineString" || !Array.isArray(value.coordinates)) {
    return null;
  }
  const line: [number, number][] = [];
  for (const point of value.coordinates) {
    if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== "number" || typeof point[1] !== "number") {
      return null;
    }
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return null;
    }
    line.push([lon, lat]);
  }
  return line;
}

// SOSAlert mirrors the openapi SOSAlert schema. SOS alerts carry a minimum
// RESTRICTED classification floor (geo.sos.v1 contract).
export interface SOSAlert {
  sosAlertId: string;
  reporterId: string;
  vesselReference?: string;
  latitudeMicros: number;
  longitudeMicros: number;
  recordedAt: string;
  freeText?: string;
  classification: Classification;
  state: "RAISED" | "ACKNOWLEDGED" | "RESOLVED";
}

export function parseSOSAlert(value: unknown): SOSAlert | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.sosAlertId !== "string" || value.sosAlertId.trim().length === 0) {
    return null;
  }
  if (typeof value.reporterId !== "string" || value.reporterId.trim().length === 0) {
    return null;
  }
  if (typeof value.latitudeMicros !== "number" || latitudeMicrosToDegrees(value.latitudeMicros) === null) {
    return null;
  }
  if (typeof value.longitudeMicros !== "number" || longitudeMicrosToDegrees(value.longitudeMicros) === null) {
    return null;
  }
  const classification = parseClassification(value.classification);
  // Contract floor: consumers must fail closed below RESTRICTED.
  if (classification === null || !classificationCovers(classification, "RESTRICTED")) {
    return null;
  }
  if (value.state !== "RAISED" && value.state !== "ACKNOWLEDGED" && value.state !== "RESOLVED") {
    return null;
  }
  if (typeof value.recordedAt !== "string" || Number.isNaN(Date.parse(value.recordedAt))) {
    return null;
  }
  const alert: SOSAlert = {
    sosAlertId: value.sosAlertId.trim(),
    reporterId: value.reporterId.trim(),
    latitudeMicros: value.latitudeMicros,
    longitudeMicros: value.longitudeMicros,
    recordedAt: value.recordedAt,
    classification,
    state: value.state,
  };
  if (typeof value.vesselReference === "string" && value.vesselReference.trim().length > 0) {
    alert.vesselReference = value.vesselReference.trim();
  }
  if (typeof value.freeText === "string" && value.freeText.trim().length > 0) {
    alert.freeText = value.freeText.trim();
  }
  return alert;
}

// canReadSOS is the console-side PBAC gate for the SOS layer: the
// geo-sos-reader (or geo-admin) role AND a clearance covering RESTRICTED,
// mirroring the geo-service listSOS enforcement. The backend remains
// authoritative; this gate decides whether the layer is fetched/rendered
// at all.
export function canReadSOS(roles: ReadonlySet<string>, clearance: Classification | null): boolean {
  const roleOk = roles.has("geo-sos-reader") || roles.has("geo-admin");
  return roleOk && clearance !== null && classificationCovers(clearance, "RESTRICTED");
}

export const GEO_READER_ROLES: readonly string[] = ["geo-reader", "geo-zone-maker", "geo-zone-checker", "geo-admin"];

// isGeoReader mirrors the geo-service read-role set; the backend enforces
// authoritatively, the portal only gates which routes render.
export function isGeoReader(roles: ReadonlySet<string>): boolean {
  return GEO_READER_ROLES.some((role) => roles.has(role));
}

// Bbox is the fixed-point micro-degree bounding box the /vessels endpoint
// expects (minLon,minLat,maxLon,maxLat).
export interface BboxMicros {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export function bboxFromDegrees(minLon: number, minLat: number, maxLon: number, maxLat: number): BboxMicros | null {
  const converted = [degreesToMicros(minLon), degreesToMicros(minLat), degreesToMicros(maxLon), degreesToMicros(maxLat)];
  if (converted.some((value) => value === null)) {
    return null;
  }
  const [a, b, c, d] = converted as [number, number, number, number];
  if (a >= c || b >= d || b < LATITUDE_MICROS_MIN || d > LATITUDE_MICROS_MAX || a < LONGITUDE_MICROS_MIN || c > LONGITUDE_MICROS_MAX) {
    return null;
  }
  return { minLon: a, minLat: b, maxLon: c, maxLat: d };
}

export function bboxToQuery(bbox: BboxMicros): string {
  return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
