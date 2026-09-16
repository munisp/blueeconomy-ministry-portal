import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "oidc-client-ts";

import { ADMINISTRATION_ROLE, AUDITOR_ROLE, DASHBOARD_ROLES, SAR_LEDGER_ROLES, extractRoles, hasAnyRole } from "../src/roles.ts";

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

// Phase 19 H2 regression: every role constant must name a role that exists
// in the blueeconomy-cvff realm catalogue (gitops
// charts/keycloak-realms/values.yaml). The previous platform-admin/auditor
// constants existed only in OPA policies / the ISR realm, which made the
// port-performance gate permanently unreachable.
const CVFF_REALM_ROLES = [
  "nimasa-approver",
  "pli-primary",
  "pli-secondary",
  "pli-tertiary",
  "receiving-bank-officer",
  "beneficiary",
  "cvff-beneficiary",
  "cbn-observer",
  "independent-auditor",
  "fmmbe-oversight",
  "icrc-observer",
];

test("all gated roles exist in the blueeconomy-cvff realm catalogue", () => {
  for (const role of [...DASHBOARD_ROLES, ...SAR_LEDGER_ROLES]) {
    assert.ok(CVFF_REALM_ROLES.includes(role), `role ${role} is not in the cvff realm catalogue`);
  }
  assert.equal(ADMINISTRATION_ROLE, "nimasa-approver");
  assert.equal(AUDITOR_ROLE, "independent-auditor");
});

test("port-performance gate accepts the administration role and rejects non-roles", () => {
  assert.equal(hasAnyRole(["nimasa-approver"], [ADMINISTRATION_ROLE]), true);
  assert.equal(hasAnyRole(["platform-admin"], [ADMINISTRATION_ROLE]), false);
});

test("SAR gate requires an existing cvff role (geo-sos-reader/geo-admin pending realm change)", () => {
  assert.equal(hasAnyRole(["fmmbe-oversight"], SAR_LEDGER_ROLES), true);
  assert.equal(hasAnyRole(["geo-sos"], SAR_LEDGER_ROLES), false);
});
