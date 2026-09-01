import type { User } from "oidc-client-ts";

/**
 * Realm roles recognised by the ministry oversight surface, per the approved
 * workstream role catalogue (charts/keycloak-realms): the ministry-portal
 * public client is issued the `fmmbe-oversight` role; `platform-admin` and
 * `auditor` are the administrative/assurance roles.
 */
export const MINISTERIAL_OVERSIGHT_ROLE = "fmmbe-oversight";
export const PLATFORM_ADMIN_ROLE = "platform-admin";
export const AUDITOR_ROLE = "auditor";

export const DASHBOARD_ROLES: readonly string[] = [
  MINISTERIAL_OVERSIGHT_ROLE,
  PLATFORM_ADMIN_ROLE,
  AUDITOR_ROLE,
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
