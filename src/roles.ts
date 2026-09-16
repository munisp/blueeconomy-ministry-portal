import type { User } from "oidc-client-ts";

/**
 * Realm roles recognised by the ministry oversight surface, per the approved
 * workstream role catalogue (gitops charts/keycloak-realms/values.yaml). The
 * ministry-portal public client authenticates against the **blueeconomy-cvff**
 * realm, whose role catalogue is:
 *   nimasa-approver, pli-primary, pli-secondary, pli-tertiary,
 *   receiving-bank-officer, beneficiary, cvff-beneficiary, cbn-observer,
 *   independent-auditor, fmmbe-oversight, icrc-observer
 *
 * Role mapping (Phase 19 H2 — every constant below MUST name a role that
 * exists in that catalogue; the previous `platform-admin` / `auditor`
 * constants existed only in OPA policies and the ISR realm, so the
 * port-performance gate was permanently unreachable):
 *   - ministerial oversight  -> fmmbe-oversight   (ministry-portal's own role)
 *   - administration         -> nimasa-approver   (NIMASA approving authority;
 *                                                  closest existing admin role)
 *   - assurance / audit      -> independent-auditor
 */
export const MINISTERIAL_OVERSIGHT_ROLE = "fmmbe-oversight";
export const ADMINISTRATION_ROLE = "nimasa-approver";
export const AUDITOR_ROLE = "independent-auditor";

export const DASHBOARD_ROLES: readonly string[] = [
  MINISTERIAL_OVERSIGHT_ROLE,
  ADMINISTRATION_ROLE,
  AUDITOR_ROLE,
];

/**
 * Incident/SAR (SOS ledger) access. The geo-service enforces
 * `geo-sos-reader` / `geo-admin` server-side
 * (blueeconomy-geo-service route registration), but **no geo-* role exists
 * in any realm of the approved Keycloak catalogue** (there is no geo realm)
 * — so no cvff-realm session can ever satisfy the geo-service check until an
 * operator adds `geo-sos-reader`/`geo-admin` to a realm
 * (gitops charts/keycloak-realms/values.yaml; OPERATOR ACTION, Phase 19 M3).
 * Until then this page is honestly gated to the closest existing roles: the
 * NIMASA approving authority and ministerial oversight, which are the roles
 * that would operate the SAR ledger.
 */
export const SAR_LEDGER_ROLES: readonly string[] = [
  ADMINISTRATION_ROLE,
  MINISTERIAL_OVERSIGHT_ROLE,
];

/**
 * Extract realm/client roles from the OIDC ID-token profile. Supports the
 * Keycloak claim shapes (realm_access.roles, resource_access.<client>.roles)
 * plus plain `roles`/`role` claims. Returns an empty array when no role
 * claims are present — callers must fail closed in that case.
 */
export function extractRoles(user: User | null, clientId?: string): string[] {
  if (user === null) {
    return [];
  }
  const profile = user.profile as Record<string, unknown>;
  const roles = new Set<string>();

  const realmAccess = profile.realm_access;
  if (typeof realmAccess === "object" && realmAccess !== null) {
    const realmRoles = (realmAccess as Record<string, unknown>).roles;
    if (Array.isArray(realmRoles)) {
      for (const role of realmRoles) {
        if (typeof role === "string") {
          roles.add(role);
        }
      }
    }
  }

  const resourceAccess = profile.resource_access;
  if (typeof resourceAccess === "object" && resourceAccess !== null) {
    for (const [client, access] of Object.entries(resourceAccess as Record<string, unknown>)) {
      if (clientId !== undefined && client !== clientId) {
        continue;
      }
      if (typeof access === "object" && access !== null) {
        const clientRoles = (access as Record<string, unknown>).roles;
        if (Array.isArray(clientRoles)) {
          for (const role of clientRoles) {
            if (typeof role === "string") {
              roles.add(role);
            }
          }
        }
      }
    }
  }

  for (const claim of [profile.roles, profile.role]) {
    if (Array.isArray(claim)) {
      for (const role of claim) {
        if (typeof role === "string") {
          roles.add(role);
        }
      }
    } else if (typeof claim === "string") {
      roles.add(claim);
    }
  }

  return [...roles];
}

export function hasAnyRole(userRoles: readonly string[], required: readonly string[]): boolean {
  return required.some((role) => userRoles.includes(role));
}
