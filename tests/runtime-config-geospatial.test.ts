import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeConfiguration } from "../src/runtime-config.ts";

function baseConfig(): Record<string, unknown> {
  return {
    application_name: "Blue Economy Platform",
    oidc: {
      authority: "https://issuer.example.invalid",
      client_id: "portal",
      redirect_uri: "https://portal.example.invalid/callback",
      scope: "openid profile",
    },
    administration: {
      onboarding_api_url: "https://admin.example.invalid/v1/onboarding/requests",
      organization_id: "approved-org",
      allowed_roles: ["stakeholder.onboarding.request"],
    },
    services: [{
      id: "evidence",
      label: "Evidence",
      health_url: "https://service.example.invalid/healthz",
      required_roles: ["evidence.read"],
    }],
  };
}

const VALID_GEOSPATIAL = {
  geo_api_url: "https://geo.example.invalid/v1/geo",
  tile_url: "https://tiles.example.invalid/{z}/{x}/{y}.png",
  tile_attribution: "Sovereign tile service",
  poll_interval_ms: 20_000,
  geolibre_enabled: false,
};

test("geospatial section is optional and validates a conformant block", () => {
  const withoutGeo = validateRuntimeConfiguration(baseConfig());
  assert.equal(withoutGeo.geospatial, undefined);

  const withGeo = validateRuntimeConfiguration({ ...baseConfig(), geospatial: VALID_GEOSPATIAL });
  assert.equal(withGeo.geospatial?.geo_api_url, "https://geo.example.invalid/v1/geo");
  assert.equal(withGeo.geospatial?.tile_url, "https://tiles.example.invalid/{z}/{x}/{y}.png");
  assert.equal(withGeo.geospatial?.poll_interval_ms, 20_000);
  assert.equal(withGeo.geospatial?.geolibre_enabled, false);
});

test("render-gating: same-origin tile paths are accepted, insecure ones refused", () => {
  const sameOrigin = validateRuntimeConfiguration({
    ...baseConfig(),
    geospatial: { ...VALID_GEOSPATIAL, tile_url: "/tiles/{z}/{x}/{y}.png" },
  });
  assert.equal(sameOrigin.geospatial?.tile_url, "/tiles/{z}/{x}/{y}.png");

  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, tile_url: "http://tiles.example.invalid/{z}/{x}/{y}.png" } }),
    /tile_url must be an HTTPS URL/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, tile_url: "https://tiles.example.invalid/plain.png" } }),
    /must be a raster tile template/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, tile_url: "https://tiles.example.invalid/{z}/{x}/{y}.png?key=abc" } }),
    /must be an HTTPS URL/,
  );
});

test("poll interval defaults and bounds are enforced", () => {
  const defaulted = validateRuntimeConfiguration({
    ...baseConfig(),
    geospatial: { geo_api_url: "https://geo.example.invalid/v1/geo", tile_url: "/tiles/{z}/{x}/{y}.png" },
  });
  assert.equal(defaulted.geospatial?.poll_interval_ms, 15_000);
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, poll_interval_ms: 500 } }),
    /poll_interval_ms/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, poll_interval_ms: 10_000_000 } }),
    /poll_interval_ms/,
  );
});

test("cesium assets stay self-hosted and the geo API must be HTTPS", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, geo_api_url: "http://geo.example.invalid/v1/geo" } }),
    /geo_api_url must be an HTTPS URL/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, cesium_base_url: "https://cdn.example.invalid/cesium/" } }),
    /cesium_base_url must be a same-origin absolute path/,
  );
});

test("geolibre pilot wiring requires a same-origin URL when enabled", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, geolibre_enabled: true } }),
    /geolibre_url is required/,
  );
  assert.throws(
    () => validateRuntimeConfiguration({ ...baseConfig(), geospatial: { ...VALID_GEOSPATIAL, geolibre_enabled: true, geolibre_url: "https://web.geolibre.app/" } }),
    /geolibre_url must be a same-origin absolute path/,
  );
  const enabled = validateRuntimeConfiguration({
    ...baseConfig(),
    geospatial: { ...VALID_GEOSPATIAL, geolibre_enabled: true, geolibre_url: "/geolibre/" },
  });
  assert.equal(enabled.geospatial?.geolibre_enabled, true);
  assert.equal(enabled.geospatial?.geolibre_url, "/geolibre/");
});
