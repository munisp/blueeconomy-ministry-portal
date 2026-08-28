import assert from "node:assert/strict";
import test from "node:test";

import {
  AdministrationApiError,
  activateOnboardingRequest,
  findOnboardingRequest,
  listOnboardingRequests,
  provisionOnboardingRequest,
  submitOnboardingDecision,
  type OnboardingRequestRecord,
} from "../src/administration-client.ts";
import type { AdministrationRuntimeConfiguration } from "../src/runtime-config.ts";

const configuration: AdministrationRuntimeConfiguration = {
  onboarding_api_url: "https://admin.example.invalid/v1/onboarding/requests",
  organization_id: "blueeconomy-stakeholders",
  allowed_roles: ["nimasa-officer"],
};

// Recorded administration-service shapes (internal/admin): the queue
// envelope from GET /v1/onboarding/requests and the updated-record body from
// POST /v1/onboarding/requests/{id}/decision.
function recordedRequest(overrides: Partial<OnboardingRequestRecord> = {}): OnboardingRequestRecord {
  return {
    id: "5f1b6d3c-9f2a-4b2e-8a3d-2f6f0a1b2c3d",
    organization_id: "blueeconomy-stakeholders",
    email: "stakeholder@example.gov.ng",
    first_name: "Amina",
    last_name: "Bello",
    requested_roles: ["nimasa-officer"],
    requester_subject: "officer-subject-1",
    status: "submitted",
    created_at: "2026-08-28T09:30:00Z",
    updated_at: "2026-08-28T09:30:00Z",
    ...overrides,
  };
}

function recordedListEnvelope(requests: OnboardingRequestRecord[], page: { limit: number; offset: number; next_offset: number | null; total: number }) {
  return { requests, page };
}

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function withFetch(stub: FetchStub, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("listOnboardingRequests parses the recorded queue envelope and builds the filtered URL", async () => {
  const envelope = recordedListEnvelope([recordedRequest()], { limit: 25, offset: 50, next_offset: null, total: 51 });
  await withFetch(async (input, init) => {
    const url = String(input);
    assert.equal(url, "https://admin.example.invalid/v1/onboarding/requests?status=pending&limit=25&offset=50");
    assert.equal(init?.method, "GET");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer token-1");
    return jsonResponse(200, envelope);
  }, async () => {
    const result = await listOnboardingRequests(configuration, "token-1", { status: "pending", limit: 25, offset: 50 });
    assert.equal(result.page.total, 51);
    assert.equal(result.page.next_offset, null);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].status, "submitted");
  });
});

test("listOnboardingRequests omits empty filters from the query string", async () => {
  await withFetch(async (input) => {
    assert.equal(String(input), "https://admin.example.invalid/v1/onboarding/requests");
    return jsonResponse(200, recordedListEnvelope([], { limit: 25, offset: 0, next_offset: null, total: 0 }));
  }, async () => {
    const result = await listOnboardingRequests(configuration, "token-1");
    assert.deepEqual(result.requests, []);
    assert.equal(result.page.total, 0);
  });
});

test("listOnboardingRequests surfaces 401 and 403 with the server error envelope", async () => {
  for (const status of [401, 403]) {
    await withFetch(async () => jsonResponse(status, { error: "authorization policy denied the request" }), async () => {
      await assert.rejects(
        () => listOnboardingRequests(configuration, "token-1"),
        (error: unknown) => {
          assert.ok(error instanceof AdministrationApiError);
          assert.equal(error.status, status);
          assert.equal(error.kind, "http");
          assert.match(error.message, /authorization policy denied the request/);
          return true;
        },
      );
    });
  }
});

test("listOnboardingRequests rejects a contract-violating envelope", async () => {
  await withFetch(async () => jsonResponse(200, { requests: [{ id: 7 }], page: { limit: 25 } }), async () => {
    await assert.rejects(
      () => listOnboardingRequests(configuration, "token-1"),
      (error: unknown) => error instanceof AdministrationApiError && error.kind === "contract",
    );
  });
});

test("network failure is classified as retryable with no status", async () => {
  await withFetch(async () => {
    throw new TypeError("fetch failed");
  }, async () => {
    await assert.rejects(
      () => listOnboardingRequests(configuration, "token-1"),
      (error: unknown) => {
        assert.ok(error instanceof AdministrationApiError);
        assert.equal(error.kind, "network");
        assert.equal(error.status, null);
        return true;
      },
    );
  });
});

test("submitOnboardingDecision posts the decision body and returns the recorded updated record", async () => {
  const updated = recordedRequest({ status: "approved", updated_at: "2026-08-28T10:00:00Z" });
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://admin.example.invalid/v1/onboarding/requests/5f1b6d3c-9f2a-4b2e-8a3d-2f6f0a1b2c3d/decision");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { decision: "approve", reason: "evidence verified" });
    return jsonResponse(200, updated);
  }, async () => {
    const result = await submitOnboardingDecision(configuration, "token-1", updated.id, "approve", "evidence verified");
    assert.equal(result.status, "approved");
  });
});

test("submitOnboardingDecision propagates maker/checker 403 and state-conflict 409", async () => {
  const cases: [number, string][] = [
    [403, "maker/checker violation: requester cannot approve their own onboarding request"],
    [409, "request is in \"approved\" state and cannot be decided"],
  ];
  for (const [status, detail] of cases) {
    await withFetch(async () => jsonResponse(status, { error: detail }), async () => {
      await assert.rejects(
        () => submitOnboardingDecision(configuration, "token-1", "5f1b6d3c-9f2a-4b2e-8a3d-2f6f0a1b2c3d", "approve", ""),
        (error: unknown) => error instanceof AdministrationApiError && error.status === status && error.message.includes(detail),
      );
    });
  }
});

test("provisionOnboardingRequest posts with no body and resolves on 204", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://admin.example.invalid/v1/onboarding/requests/abc/provision");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    return new Response(null, { status: 204 });
  }, async () => {
    await provisionOnboardingRequest(configuration, "token-1", "abc");
  });
});

test("provisionOnboardingRequest surfaces the Keycloak 502 failure truthfully", async () => {
  await withFetch(async () => jsonResponse(502, { error: "Keycloak invitation did not complete" }), async () => {
    await assert.rejects(
      () => provisionOnboardingRequest(configuration, "token-1", "abc"),
      (error: unknown) => error instanceof AdministrationApiError && error.status === 502 && error.message.includes("Keycloak invitation did not complete"),
    );
  });
});

test("activateOnboardingRequest posts the keycloak user id and resolves on 204", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://admin.example.invalid/v1/onboarding/requests/abc/activate");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { keycloak_user_id: "kc-user-9" });
    return new Response(null, { status: 204 });
  }, async () => {
    await activateOnboardingRequest(configuration, "token-1", "abc", "kc-user-9");
  });
});

test("activateOnboardingRequest rejects a missing user id (backend 400)", async () => {
  await withFetch(async () => jsonResponse(400, { error: "a Keycloak user ID is required for activation" }), async () => {
    await assert.rejects(
      () => activateOnboardingRequest(configuration, "token-1", "abc", ""),
      (error: unknown) => error instanceof AdministrationApiError && error.status === 400,
    );
  });
});

test("findOnboardingRequest pages the queue until the record is found", async () => {
  const target = recordedRequest({ id: "bbbbbbbb-0000-4000-8000-000000000000" });
  const other = recordedRequest({ id: "aaaaaaaa-0000-4000-8000-000000000000" });
  const calls: string[] = [];
  await withFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("offset=0") || !url.includes("offset=")) {
      return jsonResponse(200, recordedListEnvelope([other], { limit: 100, offset: 0, next_offset: 100, total: 2 }));
    }
    return jsonResponse(200, recordedListEnvelope([target], { limit: 100, offset: 100, next_offset: null, total: 2 }));
  }, async () => {
    const found = await findOnboardingRequest(configuration, "token-1", target.id);
    assert.equal(found?.id, target.id);
    assert.equal(calls.length, 2);
  });
});

test("findOnboardingRequest returns null for a foreign or missing record", async () => {
  await withFetch(async () => jsonResponse(200, recordedListEnvelope([], { limit: 100, offset: 0, next_offset: null, total: 0 })), async () => {
    const found = await findOnboardingRequest(configuration, "token-1", "ffffffff-0000-4000-8000-000000000000");
    assert.equal(found, null);
  });
});
