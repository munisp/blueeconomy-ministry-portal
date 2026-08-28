import assert from "node:assert/strict";
import test from "node:test";

import { parseRoute, routeHref } from "../src/router.ts";
import { heldRoles, isApprover } from "../src/roles.ts";

const VALID_ID = "5f1b6d3c-9f2a-4b2e-8a3d-2f6f0a1b2c3d";

test("hash routes parse onto the route table with a fail-closed fallback", () => {
  assert.deepEqual(parseRoute(""), { name: "overview" });
  assert.deepEqual(parseRoute("#/"), { name: "overview" });
  assert.deepEqual(parseRoute("#/approvals"), { name: "approvals" });
  assert.deepEqual(parseRoute(`#/approvals/${VALID_ID}`), { name: "approval-detail", id: VALID_ID });
  // Unknown paths and malformed ids never fabricate a detail lookup.
  assert.deepEqual(parseRoute("#/approvals/not-a-uuid"), { name: "overview" });
  assert.deepEqual(parseRoute("#/unknown/place"), { name: "overview" });
  assert.equal(routeHref({ name: "approvals" }), "#/approvals");
  assert.equal(routeHref({ name: "approval-detail", id: VALID_ID }), `#/approvals/${VALID_ID}`);
});

function tokenWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

test("heldRoles reads realm and client role claims from the access token", () => {
  const user = {
    access_token: tokenWithClaims({
      realm_access: { roles: ["nimasa-officer"] },
      resource_access: { "admin-service": { roles: ["platform-admin"] } },
    }),
  } as Parameters<typeof heldRoles>[0];
  const roles = heldRoles(user);
  assert.ok(roles.has("nimasa-officer"));
  assert.ok(roles.has("platform-admin"));
  assert.ok(isApprover(roles));
});

test("heldRoles fails closed on malformed tokens and missing claims", () => {
  assert.equal(heldRoles(null).size, 0);
  const noClaims = { access_token: tokenWithClaims({}) } as Parameters<typeof heldRoles>[0];
  assert.equal(heldRoles(noClaims).size, 0);
  const malformed = { access_token: "not-a-jwt" } as Parameters<typeof heldRoles>[0];
  assert.equal(heldRoles(malformed).size, 0);
  const operatorOnly = {
    access_token: tokenWithClaims({ realm_access: { roles: ["nwa-officer"] } }),
  } as Parameters<typeof heldRoles>[0];
  assert.ok(!isApprover(heldRoles(operatorOnly)));
});
