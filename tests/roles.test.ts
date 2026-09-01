import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "oidc-client-ts";

import { DASHBOARD_ROLES, extractRoles, hasAnyRole } from "../src/roles.ts";

function userWithProfile(profile: Record<string, unknown>): User {
  return { profile } as unknown as User;
}

test("extracts Keycloak realm roles", () => {
  const roles = extractRoles(userWithProfile({ realm_access: { roles: ["fmmbe-oversight", "auditor"] } }));
  assert.deepEqual(roles.sort(), ["auditor", "fmmbe-oversight"]);
});

test("extracts client roles for the configured client only", () => {
  const roles = extractRoles(
    userWithProfile({
      resource_access: {
        "ministry-portal": { roles: ["fmmbe-oversight"] },
        "other-client": { roles: ["superuser"] },
      },
    }),
    "ministry-portal",
  );
  assert.deepEqual(roles, ["fmmbe-oversight"]);
});

test("returns no roles for an anonymous session", () => {
  assert.deepEqual(extractRoles(null), []);
});

test("returns no roles when the token carries none (fail closed)", () => {
  assert.deepEqual(extractRoles(userWithProfile({ sub: "abc" })), []);
  assert.equal(hasAnyRole([], DASHBOARD_ROLES), false);
});

test("dashboard gate accepts the ministerial oversight role", () => {
  assert.equal(hasAnyRole(["fmmbe-oversight"], DASHBOARD_ROLES), true);
  assert.equal(hasAnyRole(["trucker"], DASHBOARD_ROLES), false);
});
