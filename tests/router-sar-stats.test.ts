import assert from "node:assert/strict";
import test from "node:test";

import { parseRoute, routeHref } from "../src/router.ts";

test("SAR and statistics hashes parse onto the route table", () => {
  assert.deepEqual(parseRoute("#/sar"), { name: "sar" });
  assert.deepEqual(parseRoute("#/statistics"), { name: "statistics" });
  assert.deepEqual(parseRoute("#/sar/sar-000001"), { name: "sar-case", caseId: "sar-000001" });
});

test("malformed SAR case ids fall back to the overview rather than fabricating a lookup", () => {
  assert.deepEqual(parseRoute("#/sar/"), { name: "sar" });
  assert.deepEqual(parseRoute("#/sar/x"), { name: "overview" });
  assert.deepEqual(parseRoute("#/sar/some case"), { name: "overview" });
  assert.deepEqual(parseRoute("#/sar/sar-000001/extra"), { name: "overview" });
});

test("routeHref round-trips the new routes", () => {
  assert.equal(routeHref({ name: "sar" }), "#/sar");
  assert.equal(routeHref({ name: "sar-case", caseId: "sar-000001" }), "#/sar/sar-000001");
  assert.equal(routeHref({ name: "statistics" }), "#/statistics");
  assert.deepEqual(parseRoute(routeHref({ name: "sar-case", caseId: "sar-000001" })), { name: "sar-case", caseId: "sar-000001" });
});
