// map-style is the single source of truth for layer styling shared by the
// Cesium 3D engine and the MapLibre 2D fallback so both render the same
// truth identically (source-class identity, unmatched/dark tracks,
// staleness, SOS priority).
import type { Classification, PositionSourceClass } from "./geo-model";

export const SOURCE_CLASS_COLORS: Record<PositionSourceClass, string> = {
  AIS: "#58c4dd",
  GSM_TRACKER: "#9be2b8",
  SAT_TRACKER: "#b39ddb",
  APP_REPORT: "#e9c46a",
};

export const UNMATCHED_COLOR = "#9aabb2";
export const STALE_OPACITY = 0.45;
export const SOS_COLOR = "#ff5252";
export const TRACK_COLOR = "#f4d166";
export const ZONE_FILL_COLOR = "#7de2dc";
export const ZONE_OUTLINE_COLOR = "#7de2dc";

export function vesselColorHex(sourceClass: PositionSourceClass, unmatched: boolean): string {
  return unmatched ? UNMATCHED_COLOR : SOURCE_CLASS_COLORS[sourceClass];
}

// classificationChipClass maps the clearance-ladder label onto the portal's
// existing status-chip styling convention.
export function classificationChipClass(label: Classification): string {
  switch (label) {
    case "PUBLIC":
      return "status-chip status-chip--active";
    case "INTERNAL":
      return "status-chip status-chip--approved";
    case "RESTRICTED":
      return "status-chip status-chip--submitted";
    case "CONFIDENTIAL":
    case "SECRET":
      return "status-chip status-chip--rejected";
  }
}
