import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUserManagerSettings,
  classifyAuthenticationError,
  stripOidcResponseParameters,
} from "../src/auth";

const OIDC_CONFIGURATION = {
  authority: "https://idp.example.gov/realms/blueeconomy",
  client_id: "ministry-portal",
  redirect_uri: "https://portal.example.gov/callback",
  post_logout_redirect_uri: "https://portal.example.gov/",
  scope: "openid profile",
};

describe("classifyAuthenticationError", () => {
  it("classifies a stale callback state-store failure as an OIDC state error", () => {
    assert.equal(
      classifyAuthenticationError(new Error("No matching state found in storage")),
      "oidc-state",
    );
  });

  it("classifies oidc-client-ts protocol/timeout errors by name as OIDC state errors", () => {
    const errorResponse = Object.assign(new Error("login_required"), { name: "ErrorResponse" });
    assert.equal(classifyAuthenticationError(errorResponse), "oidc-state");
    const timeout = Object.assign(new Error("timed out"), { name: "ErrorTimeout" });
    assert.equal(classifyAuthenticationError(timeout), "oidc-state");
  });

  it("classifies genuine configuration failures as configuration errors", () => {
    assert.equal(
      classifyAuthenticationError(new Error("runtime configuration request failed with HTTP 403")),
      "configuration",
    );
    assert.equal(
      classifyAuthenticationError(new Error("oidc.authority must be an HTTPS URL without credentials")),
      "configuration",
    );
  });

  it("leaves unknown failures as unexpected", () => {
    assert.equal(classifyAuthenticationError(new Error("boom")), "unexpected");
    assert.equal(classifyAuthenticationError("boom"), "unexpected");
    assert.equal(classifyAuthenticationError(null), "unexpected");
  });
});

describe("stripOidcResponseParameters", () => {
  it("removes code and state while preserving other query parameters and the hash route", () => {
    const cleaned = stripOidcResponseParameters(
      "https://portal.example.gov/callback?code=abc123&state=xyz&keep=1#/administration",
    );
    assert.equal(cleaned, "https://portal.example.gov/callback?keep=1#/administration");
  });

  it("removes session_state, iss and error parameters", () => {
    const cleaned = stripOidcResponseParameters(
      "https://portal.example.gov/callback?session_state=s&iss=https%3A%2F%2Fidp.example.gov&error=login_required&error_description=expired&error_uri=u",
    );
    assert.equal(cleaned, "https://portal.example.gov/callback");
  });

  it("returns the input unchanged when no OIDC parameters are present", () => {
    const url = "https://portal.example.gov/callback?keep=1#/executive";
    assert.equal(stripOidcResponseParameters(url), url);
  });
});

describe("buildUserManagerSettings", () => {
  it("enables automatic silent renew so short-lived tokens do not lapse mid-session", () => {
    const settings = buildUserManagerSettings(OIDC_CONFIGURATION);
    assert.equal(settings.automaticSilentRenew, true);
    assert.equal(typeof settings.accessTokenExpiringNotificationTimeInSeconds, "number");
    assert.ok((settings.accessTokenExpiringNotificationTimeInSeconds ?? 0) > 0);
  });

  it("keeps the approved authority, client and redirect configuration", () => {
    const settings = buildUserManagerSettings(OIDC_CONFIGURATION);
    assert.equal(settings.authority, OIDC_CONFIGURATION.authority);
    assert.equal(settings.client_id, OIDC_CONFIGURATION.client_id);
    assert.equal(settings.redirect_uri, OIDC_CONFIGURATION.redirect_uri);
    assert.equal(settings.post_logout_redirect_uri, OIDC_CONFIGURATION.post_logout_redirect_uri);
    assert.equal(settings.scope, OIDC_CONFIGURATION.scope);
  });
});
