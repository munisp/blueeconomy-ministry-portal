import assert from "node:assert/strict";
import test from "node:test";

import { detectWebGL2, resolveEngine } from "../src/tracking/map-support.ts";

test("auto preference selects Cesium 3D with WebGL2 and MapLibre 2D without", () => {
  assert.equal(resolveEngine("auto", true), "cesium3d");
  assert.equal(resolveEngine("auto", false), "maplibre2d");
});

test("an explicit Cesium preference degrades to MapLibre when WebGL2 is missing", () => {
  assert.equal(resolveEngine("cesium3d", true), "cesium3d");
  assert.equal(resolveEngine("cesium3d", false), "maplibre2d");
  assert.equal(resolveEngine("maplibre2d", true), "maplibre2d");
  assert.equal(resolveEngine("maplibre2d", false), "maplibre2d");
});

test("WebGL2 detection reflects the probe outcome and fails closed", () => {
  assert.equal(detectWebGL2(() => ({ getContext: () => ({}) })), true);
  assert.equal(detectWebGL2(() => ({ getContext: () => null })), false);
  assert.equal(detectWebGL2(() => { throw new Error("no DOM"); }), false);
});
