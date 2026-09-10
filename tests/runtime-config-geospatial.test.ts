import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeConfiguration } from "../src/runtime-config.ts";

const BASE = {
  application_name: "Portal",
  oidc: {
    authority: "https://id.example.com/realms/mbe",
    client_id: "ministry-portal",
    redirect_uri: "https://portal.example.com/",
    scope: "openid profile",
  },
  administration: {
    onboarding_api_url: "https://admin.example.com",
    organization_id: "org-1",
    allowed_roles: ["platform-admin"],
  },
  services: [
    { id: "singlewindow", label: "NSW", health_url: "https://nsw.example.com/health", required_roles: ["fmmbe-oversight"] },
  ],
};

test("configuration without a geospatial block remains valid (backward compatible)", () => {
  const configuration = validateRuntimeConfiguration(BASE);
  assert.equal(configuration.geospatial, undefined);
});

test("accepts a same-origin tile style path and an HTTPS style URL", () => {
  const sameOrigin = validateRuntimeConfiguration({ ...BASE, geospatial: { tile_style_url: "/tiles/style.json" } });
  assert.equal(sameOrigin.geospatial?.tile_style_url, "/tiles/style.json");
  const remote = validateRuntimeConfiguration({ ...BASE, geospatial: { tile_style_url: "https://tiles.example.com/style.json" } });
  assert.equal(remote.geospatial?.tile_style_url, "https://tiles.example.com/style.json");
});

test("rejects non-HTTPS tile style URLs (CSP / mixed-content guard)", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...BASE, geospatial: { tile_style_url: "http://tiles.example.com/style.json" } }),
    /must be an HTTPS URL/,
  );
});

test("validates the default bbox bounds and ordering", () => {
  const configuration = validateRuntimeConfiguration({
    ...BASE,
    geospatial: { default_bbox: { min_lon: 2.5, min_lat: 4.0, max_lon: 15.0, max_lat: 14.5 } },
  });
  assert.equal(configuration.geospatial?.default_bbox?.min_lon, 2.5);
  assert.throws(
    () => validateRuntimeConfiguration({ ...BASE, geospatial: { default_bbox: { min_lon: 10, min_lat: 4, max_lon: 5, max_lat: 14 } } }),
    /min bounds must be below max bounds/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...BASE, geospatial: { default_bbox: { min_lon: -200, min_lat: 4, max_lon: 5, max_lat: 14 } } }),
    /must be a number in \[-180, 180\]/,
  );
});

test("rejects a non-object geospatial block", () => {
  assert.throws(() => validateRuntimeConfiguration({ ...BASE, geospatial: "tiles" }), /geospatial must be an object/);
});
