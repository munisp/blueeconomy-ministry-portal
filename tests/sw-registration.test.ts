import assert from "node:assert/strict";
import test from "node:test";

import { registerServiceWorker } from "../src/sw-registration.ts";

test("reports unsupported when no service worker container exists", async () => {
  const result = await registerServiceWorker("/sw.js", {});
  assert.equal(result.registered, false);
  assert.match(result.reason ?? "", /not supported/);
});

test("reports unsupported when no environment exists", async () => {
  const result = await registerServiceWorker("/sw.js", undefined);
  assert.equal(result.registered, false);
});

test("registers the service worker script", async () => {
  const registered: string[] = [];
  const result = await registerServiceWorker("/sw.js", {
    serviceWorker: {
      register: (scriptUrl: string) => {
        registered.push(scriptUrl);
        return Promise.resolve({});
      },
    },
  });
  assert.equal(result.registered, true);
  assert.deepEqual(registered, ["/sw.js"]);
});

test("fails soft when registration rejects", async () => {
  const result = await registerServiceWorker("/sw.js", {
    serviceWorker: {
      register: () => Promise.reject(new Error("secure context required")),
    },
  });
  assert.equal(result.registered, false);
  assert.match(result.reason ?? "", /secure context required/);
});
