import type { User } from "oidc-client-ts";
import { parseClassification, type Classification } from "./tracking/geo-model";

// Approver roles mirror the administration-service route policy for the
// onboarding approver queue and decision/provision/activate verbs
// (internal/admin/authz.go). The backend remains authoritative: this guard
// only decides which navigation entries and pages the portal renders.
export const APPROVER_ROLES: readonly string[] = ["platform-admin", "nimasa-officer"];

// heldRoles reads the Keycloak role claims from the access token: realm
// roles from realm_access.roles and client roles from every
// resource_access entry, matching the service-side claim mapping. Any
// malformed claim structure yields an empty set (fail-closed).
export function heldRoles(user: User | null): Set<string> {
  const roles = new Set<string>();
  if (user === null || typeof user.access_token !== "string" || user.access_token.length === 0) {
    return roles;
  }
  const claims = decodeJwtPayload(user.access_token);
  if (claims === null) {
    return roles;
  }
  const realmAccess = claims.realm_access;
  if (typeof realmAccess === "object" && realmAccess !== null && "roles" in realmAccess && Array.isArray(realmAccess.roles)) {
    for (const role of realmAccess.roles) {
      if (typeof role === "string" && role.trim().length > 0) {
        roles.add(role.trim());
      }
    }
  }
  const resourceAccess = claims.resource_access;
  if (typeof resourceAccess === "object" && resourceAccess !== null) {
    for (const entry of Object.values(resourceAccess)) {
      if (typeof entry === "object" && entry !== null && "roles" in entry && Array.isArray(entry.roles)) {
        for (const role of entry.roles) {
          if (typeof role === "string" && role.trim().length > 0) {
            roles.add(role.trim());
          }
        }
      }
    }
  }
  return roles;
}

export function isApprover(roles: Set<string>): boolean {
  return APPROVER_ROLES.some((role) => roles.has(role));
}

// SAR reader roles mirror the maritime-intelligence read policy
// (internal/isr/access.go sarReaderRoles): read-only console access plus
// the operational SAR roles and auditor. The backend re-enforces role and
// per-record clearance authoritatively.
export const SAR_READER_ROLES: readonly string[] = ["sar-watchkeeper", "sar-coordinator", "sar-resourcer", "sar-observer", "auditor"];

export function isSarReader(roles: ReadonlySet<string>): boolean {
  return SAR_READER_ROLES.some((role) => roles.has(role));
}

// STATS_READER_ROLES mirrors the data-platform statistics API requirement
// (stats_api.py REQUIRED_ROLE = "stats-reader").
export const STATS_READER_ROLES: readonly string[] = ["stats-reader"];

export function isStatsReader(roles: ReadonlySet<string>): boolean {
  return STATS_READER_ROLES.some((role) => roles.has(role));
}

// heldClearance reads the geo clearance-ladder claim ("clearance") asserted
// by the identity authority, matching the geo-service claim mapping
// (internal/auth: an absent claim defaults to PUBLIC, the least-restrictive
// label). An unparseable claim fails closed to null; the geo backend
// remains the authoritative clearance enforcer.
export function heldClearance(user: User | null): Classification | null {
  if (user === null || typeof user.access_token !== "string" || user.access_token.length === 0) {
    return null;
  }
  const claims = decodeJwtPayload(user.access_token);
  if (claims === null) {
    return null;
  }
  if (!("clearance" in claims)) {
    return "PUBLIC";
  }
  return parseClassification(claims.clearance);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3 || segments[1] === "") {
    return null;
  }
  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized);
    const candidate: unknown = JSON.parse(decoded);
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    return candidate as Record<string, unknown>;
  } catch {
    return null;
  }
}
