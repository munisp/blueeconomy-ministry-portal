import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { OidcRuntimeConfiguration } from "./runtime-config";

export function createUserManager(configuration: OidcRuntimeConfiguration): UserManager {
  return new UserManager({
    authority: configuration.authority,
    client_id: configuration.client_id,
    redirect_uri: configuration.redirect_uri,
    post_logout_redirect_uri: configuration.post_logout_redirect_uri,
    response_type: "code",
    scope: configuration.scope,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: false,
    filterProtocolClaims: true,
    loadUserInfo: false,
  });
}

export async function completeAuthenticationCallback(manager: UserManager): Promise<User | null> {
  const hasOidcResponse = new URL(window.location.href).searchParams.has("code");
  if (!hasOidcResponse) {
    return null;
  }
  return manager.signinRedirectCallback();
}

export function accessToken(user: User | null): string | null {
  if (user === null || user.expired || user.access_token.trim().length === 0) {
    return null;
  }
  return user.access_token;
}
