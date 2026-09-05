import { UserManager, WebStorageStateStore, type User, type UserManagerSettings } from "oidc-client-ts";
import type { OidcRuntimeConfiguration } from "./runtime-config";

/**
 * Classification of authentication failures so the UI can render an
 * honest, recoverable state instead of conflating them.
 */
export type AuthenticationErrorKind = "oidc-state" | "configuration" | "unexpected";

const OIDC_STATE_ERROR_PATTERN = /no matching state|state (?:not found|mismatch)|invalid state|login_required|interaction_required|session (?:expired|not found)|silent renew|token (?:expired|renewal)/i;

export function classifyAuthenticationError(error: unknown): AuthenticationErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (OIDC_STATE_ERROR_PATTERN.test(message)) {
    return "oidc-state";
  }
  if (/configuration|is required|must be|non-empty|approved environment/i.test(message)) {
    return "configuration";
  }
  // oidc-client-ts raises ErrorResponse / ErrorTimeout for protocol and
  // state-store problems; both mean the sign-in attempt cannot be resumed
  // and the user must start a fresh redirect.
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^(ErrorResponse|ErrorTimeout)$/.test(name)) {
      return "oidc-state";
    }
  }
  return "unexpected";
}

const OIDC_RESPONSE_PARAMETERS = ["code", "state", "session_state", "iss", "error", "error_description", "error_uri"] as const;

/**
 * Remove OIDC authorization-response parameters from a URL while keeping
 * the path and hash-route intact. Returns the cleaned URL; when nothing
 * was removed the input is returned unchanged.
 */
export function stripOidcResponseParameters(url: string): string {
  const parsed = new URL(url);
  let removed = false;
  for (const parameter of OIDC_RESPONSE_PARAMETERS) {
    if (parsed.searchParams.has(parameter)) {
      parsed.searchParams.delete(parameter);
      removed = true;
    }
  }
  if (!removed) {
    return url;
  }
  const search = parsed.searchParams.toString();
  return `${parsed.origin}${parsed.pathname}${search.length > 0 ? `?${search}` : ""}${parsed.hash}`;
}

export function buildUserManagerSettings(configuration: OidcRuntimeConfiguration): UserManagerSettings {
  return {
    authority: configuration.authority,
    client_id: configuration.client_id,
    redirect_uri: configuration.redirect_uri,
    post_logout_redirect_uri: configuration.post_logout_redirect_uri,
    response_type: "code",
    scope: configuration.scope,
    userStore: typeof window === "undefined" ? undefined : new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: typeof window === "undefined" ? undefined : new WebStorageStateStore({ store: window.sessionStorage }),
    // Renew short-lived (~300s) tokens in the background instead of letting
    // the session silently expire mid-use.
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    // Silent renew reuses redirect_uri via a hidden iframe against the realm's
    // authorization endpoint (oidc-client-ts default silent_redirect_uri).
    filterProtocolClaims: true,
    loadUserInfo: false,
  };
}

export function createUserManager(configuration: OidcRuntimeConfiguration): UserManager {
  return new UserManager(buildUserManagerSettings(configuration));
}

export async function completeAuthenticationCallback(manager: UserManager): Promise<User | null> {
  const hasOidcResponse = new URL(window.location.href).searchParams.has("code");
  if (!hasOidcResponse) {
    return null;
  }
  try {
    return await manager.signinRedirectCallback();
  } finally {
    // Always strip the one-time code/state pair from the address bar so a
    // reload, duplicate or revisit can never replay the callback.
    const cleaned = stripOidcResponseParameters(window.location.href);
    if (cleaned !== window.location.href) {
      window.history.replaceState(window.history.state, document.title, cleaned);
    }
  }
}

export function accessToken(user: User | null): string | null {
  if (user === null || user.expired || user.access_token.trim().length === 0) {
    return null;
  }
  return user.access_token;
}
